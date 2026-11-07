-- 0021 colgo el disparador de auditoria de `location_area` y `location_tag` sin decirle cual
-- es la llave, y estas dos tablas no tienen columna `id`: la llave salia nula y cualquier
-- cambio de area reventaba. Van por `location_id`, que es de lo que hablan.
drop trigger location_area_audit on location_area;
create trigger location_area_audit after insert or update or delete on location_area
for each row execute function audit_changes('location_id');

drop trigger location_tag_audit on location_tag;
create trigger location_tag_audit after insert or update or delete on location_tag
for each row execute function audit_changes('location_id');

-- ---------------------------------------------------------------------------------------
-- Las areas, como dato
-- ---------------------------------------------------------------------------------------

/**
 * Las areas existian como tabla y no como dato, asi que el motor de ubicacion decidia con
 * `zone.kind in ('rack','floor')` escrito a mano. Con eso un pallet de producto podia
 * terminar en una posicion de corrugado, y no habia forma de mandar nada a calidad.
 *
 * Arranca todo lo fisico en ALMACEN. PICKING nace vacia: la define el jefe de bodega
 * moviendo posiciones, porque las areas no son fijas y van a cambiar.
 */
insert into area (site_id, code, name, type_code, barcode)
select s.id, a.code, a.name, a.type_code, a.barcode
from site s
cross join (values
  ('ALMACEN',     'Almacén de pallets completos', 'ALMACEN',     null),
  ('PICKING',     'Picking, pallets abiertos',    'PICKING',     null),
  ('CALIDAD',     'Calidad',                      'CALIDAD',     'AREA-CALIDAD'),
  ('DESGUACE',    'Desguace',                     'DESGUACE',    'AREA-DESGUACE'),
  ('CONTENEDOR',  'Contenedores de patio',        'CONTENEDOR',  'AREA-CONTENEDOR'),
  ('CROSSDOCK',   'Cross-dock',                   'CROSSDOCK',   'AREA-CROSSDOCK'),
  ('RETORNABLES', 'Corrugado y pallet de retorno','RETORNABLES', 'AREA-RETORNABLES')
) as a(code, name, type_code, barcode)
where s.code = 'PLM';

insert into location_area (location_id, area_id)
select l.id, a.id
from location l
join lane la on la.id = l.lane_id
join zone z on z.id = la.zone_id
cross join area a
where a.code = 'ALMACEN'
  and z.kind in ('rack', 'floor')
  and l.retired_at is null;

/**
 * Toda posicion nace en un area. Hace falta un disparador y no solo la carga de arriba,
 * porque `generate_zone_locations` se vuelve a correr cada vez que cambia un rack: una
 * posicion sin area quedaria invisible para el motor de ubicacion.
 */
create function location_area_por_defecto() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_area uuid;
begin
  select a.id into v_area
  from lane la
  join zone z on z.id = la.zone_id
  join area a on a.site_id = z.site_id
  where la.id = new.lane_id and a.code = 'ALMACEN' and z.kind in ('rack', 'floor');

  if v_area is not null then
    insert into location_area (location_id, area_id)
    values (new.id, v_area)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

create trigger location_area_defecto after insert on location
for each row execute function location_area_por_defecto();

/** El area vigente de una posicion. Una sola, por el indice unico de 0021. */
create function area_de(p_location_id uuid) returns area
language sql stable set search_path = public as $$
  select a.*
  from location_area la
  join area a on a.id = la.area_id
  where la.location_id = p_location_id and la.valid_to is null;
$$;

/** Mueve posiciones de area cerrando la vigencia anterior. Es como se redefine el picking. */
create function reasignar_area(p_location_ids uuid[], p_area_code text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_area area;
  v_n integer;
begin
  if not has_role('supervisor', 'admin') then
    raise exception 'Solo el jefe de bodega cambia las áreas';
  end if;

  select * into v_area from area where code = p_area_code and is_active;
  if not found then
    raise exception 'El área % no existe', p_area_code;
  end if;

  -- clock_timestamp() avanza dentro de la transaccion: si se reasigna dos veces seguidas,
  -- la vigencia que se cierra y la que se abre no caen en el mismo instante.
  update location_area set valid_to = clock_timestamp()
  where location_id = any(p_location_ids) and valid_to is null and area_id <> v_area.id;

  insert into location_area (location_id, area_id, valid_from)
  select l.id, v_area.id, clock_timestamp()
  from location l
  where l.id = any(p_location_ids)
    and not exists (
      select 1 from location_area x
      where x.location_id = l.id and x.valid_to is null
    );

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

grant execute on function area_de, reasignar_area to authenticated;

-- ---------------------------------------------------------------------------------------
-- El motor de ubicacion
-- ---------------------------------------------------------------------------------------

/**
 * Sugiere donde guardar un pallet completo. Respeta tres cosas que antes ignoraba:
 *   1. para que sirve la posicion (`location_usage.holds_product`);
 *   2. en que area esta hoy: un pallet completo va a ALMACEN, no a picking;
 *   3. hasta donde alcanza el equipo de quien va a guardarlo (`p_max_level`).
 *
 * La homogeneidad de carril se queda, y de paso resuelve el bloqueo del rack de doble
 * profundidad: si al fondo y al frente va el mismo producto y el mismo lote, bajar el de
 * adelante es equivalente, asi que ordenar por `depth_index` basta.
 */
drop function suggest_putaway_location(uuid, text, date);

create function suggest_putaway_location(
  p_product_id uuid,
  p_lot text default null,
  p_expiry date default null,
  p_max_level smallint default null
) returns uuid
language sql stable security definer set search_path = public as $$
  select l.id
  from location l
  join lane la on la.id = l.lane_id
  join location_usage u on u.code = l.usage_code
  join location_area lar on lar.location_id = l.id and lar.valid_to is null
  join area a on a.id = lar.area_id
  join area_type tp on tp.code = a.type_code
  left join stock s on s.location_id = l.id and s.qty_base > 0
  where l.retired_at is null
    and l.status = 'available'
    and l.reserved_by_task_id is null
    and u.holds_product
    and a.is_active
    and not tp.is_virtual
    and a.code = 'ALMACEN'
    and (p_max_level is null or coalesce(l.level, 0) <= p_max_level)
    and not exists (
      select 1 from stock otro
      join location ol on ol.id = otro.location_id
      where ol.lane_id = l.lane_id and otro.qty_base > 0
        and (otro.product_id <> p_product_id or otro.lot is distinct from p_lot)
    )
  order by
    (s.product_id is not null) desc,
    coalesce(l.level, 0),
    l.pick_sequence nulls last,
    l.code
  limit 1;
$$;

-- ---------------------------------------------------------------------------------------
-- Recepcion en unidades base
-- ---------------------------------------------------------------------------------------

/**
 * Recibe un pallet. El operario cuenta cajas; el inventario se lleva en unidades base,
 * asi que la conversion pasa aqui con el factor del nivel de empaque.
 *
 * La tarea de guardado nace sabiendo a que nivel hay que subir (`min_level`) y de que lado
 * de la operacion es (`flow`), que es lo que deja repartir el trabajo por equipo.
 */
drop function receive_pallet(text, uuid, uuid, numeric, uuid, text, date, text);

create function receive_pallet(
  p_lpn_code text,
  p_product_id uuid,
  p_packaging_level_id uuid,
  p_cases numeric,
  p_dock_location_id uuid,
  p_lot text default null,
  p_expiry date default null,
  p_idempotency_key text default null,
  p_max_level smallint default null
) returns table (lpn_id uuid, lpn_code text, task_id uuid, to_location_id uuid, to_location_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_code text := trim(p_lpn_code);
  v_lpn lpn;
  v_previa record;
  v_destino uuid;
  v_task uuid;
  v_product product;
  v_por_caja numeric;
  v_qty numeric;
begin
  if auth.uid() is null then
    raise exception 'Hace falta una sesion para recibir';
  end if;

  if length(v_code) < 4 then
    raise exception 'Escanea la etiqueta del pallet';
  end if;

  select l.code, loc.code as ubicacion into v_previa
  from lpn l
  left join stock s on s.lpn_id = l.id and s.qty_base > 0
  left join location loc on loc.id = s.location_id
  where l.code = v_code
  limit 1;

  if found then
    raise exception 'El pallet % ya está en el sistema%', v_code,
      coalesce(', en ' || v_previa.ubicacion, '');
  end if;

  select * into v_product from product where id = p_product_id;
  if not found then
    raise exception 'El producto no existe';
  end if;
  if v_product.status <> 'active' then
    raise exception 'El producto esta % y no se puede recibir', v_product.status;
  end if;
  if v_product.requires_fefo and p_expiry is null then
    raise exception 'Este producto exige fecha de vencimiento';
  end if;

  select qty_base_units into v_por_caja from packaging_level where id = p_packaging_level_id;
  if v_por_caja is null then
    raise exception 'Ese empaque no existe';
  end if;
  v_qty := p_cases * v_por_caja;

  insert into lpn (code, created_by, level, source)
  values (v_code, auth.uid(), 'PALLET', 'NEST')
  returning * into v_lpn;

  perform post_movement(
    'RECEIPT', p_product_id, v_qty, null, p_dock_location_id, v_lpn.id,
    p_lot, p_expiry, null, null, p_packaging_level_id, null, null, p_idempotency_key
  );

  v_destino := suggest_putaway_location(p_product_id, p_lot, p_expiry, p_max_level);

  insert into task (
    type, product_id, qty_base, packaging_level_id, lpn_id, lot, expiry_date,
    from_location_id, to_location_id, zone_id, priority, min_level, flow
  )
  select
    'PUTAWAY', p_product_id, v_qty, p_packaging_level_id, v_lpn.id, p_lot, p_expiry,
    p_dock_location_id, v_destino, la.zone_id, 100, coalesce(l.level, 0), 'INBOUND'
  from location l join lane la on la.id = l.lane_id
  where l.id = coalesce(v_destino, p_dock_location_id)
  returning id into v_task;

  if v_destino is not null then
    update location
    set reserved_by_task_id = v_task, reserved_until = now() + interval '2 hours'
    where id = v_destino;
  end if;

  return query
  select v_lpn.id, v_lpn.code, v_task, v_destino, l.code
  from location l where l.id = v_destino;
end;
$$;

grant execute on function receive_pallet to authenticated;

-- ---------------------------------------------------------------------------------------
-- Surtido: de donde se puede tomar
-- ---------------------------------------------------------------------------------------

/**
 * Libera un pedido. Cambios frente a 0020:
 *   - solo toma de posiciones que guardan producto y de areas no virtuales;
 *   - prefiere PICKING sobre ALMACEN, que es la regla de la bodega: en almacen hay pallets
 *     completos y en picking se abren;
 *   - la cantidad del pedido llega en cajas y se convierte a unidades base;
 *   - la tarea nace con `min_level` y `flow`, para poder repartirla por equipo.
 */
create or replace function release_order(p_order_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_order sales_order;
  v_line order_line;
  v_destino uuid;
  v_falta numeric;
  v_toma numeric;
  v_task uuid;
  v_tareas integer := 0;
  s record;
begin
  if not has_role('supervisor', 'admin') then
    raise exception 'No tienes permiso para liberar pedidos';
  end if;

  select * into v_order from sales_order where id = p_order_id for update;
  if not found then
    raise exception 'El pedido no existe';
  end if;
  if v_order.status <> 'DRAFT' then
    raise exception 'El pedido ya está %', v_order.status;
  end if;
  if v_order.dock_door_id is null then
    raise exception 'El pedido necesita un andén de carga';
  end if;

  select l.id into v_destino
  from location l
  join dock_door d on d.id = v_order.dock_door_id
  where l.code = 'STG-' || d.code;

  for v_line in select * from order_line where order_id = p_order_id order by line_no loop
    v_falta := v_line.qty_base;

    for s in
      select st.id, st.location_id, st.lot, st.expiry_date, st.lpn_id,
             st.qty_base - st.qty_allocated as libre,
             coalesce(lo.level, 0) as nivel,
             case when a.code = 'PICKING' then 0 else 1 end as prioridad_area
      from stock st
      join location lo on lo.id = st.location_id
      join location_usage u on u.code = lo.usage_code
      join location_area lar on lar.location_id = lo.id and lar.valid_to is null
      join area a on a.id = lar.area_id
      join area_type tp on tp.code = a.type_code
      where st.product_id = v_line.product_id
        and st.qty_base > st.qty_allocated
        and u.holds_product
        and a.is_active
        and not tp.is_virtual
      order by
        prioridad_area,
        st.expiry_date nulls last,
        lo.depth_index,
        lo.pick_sequence nulls last,
        lo.code
    loop
      exit when v_falta <= 0;

      v_toma := least(v_falta, s.libre);
      update stock set qty_allocated = qty_allocated + v_toma where id = s.id;

      insert into task (
        type, product_id, qty_base, packaging_level_id, lpn_id, lot, expiry_date,
        from_location_id, to_location_id, priority, min_level, flow
      )
      values (
        'PICK', v_line.product_id, v_toma, v_line.packaging_level_id, s.lpn_id, s.lot,
        s.expiry_date, s.location_id, v_destino, 200, s.nivel, 'OUTBOUND'
      )
      returning id into v_task;

      insert into allocation (order_line_id, stock_id, qty_base, task_id)
      values (v_line.id, s.id, v_toma, v_task);

      v_falta := v_falta - v_toma;
      v_tareas := v_tareas + 1;
    end loop;

    if v_falta > 0 then
      raise exception 'Falta existencia de la línea %: hacen falta % más',
        v_line.line_no, trim_scale(v_falta)
        using errcode = 'check_violation';
    end if;
  end loop;

  update sales_order set status = 'RELEASED', released_at = now() where id = p_order_id;
  return v_tareas;
end;
$$;
