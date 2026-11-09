/**
 * El producto que entra y sale el mismo día.
 *
 * Pasa de verdad: a un despacho le falta un producto, lo esperan, llega en un camión de
 * ingreso y lo meten directo al de despacho sin pasar por ninguna posición del almacén.
 *
 * La regla que lo hace usable es **cuándo se ofrece**: no al bajar la carga —hacer que
 * escaneen el andén en cada pallet para un caso excepcional es castigar los cien casos
 * normales— sino en el momento en que el sistema ya sugirió dónde guardar. Ahí el operario
 * ya sabe qué tiene en las manos, y el sistema ya sabe si algún camión abierto lo necesita.
 * Si no lo necesita nadie, la opción no aparece.
 *
 * Y de paso se cierra un agujero viejo: nadie sacaba el producto del andén al despachar. El
 * camión salía, el pedido quedaba SHIPPED, y las cajas seguían apareciendo en el andén para
 * siempre. Sin eso, el crossdock sólo habría inventado más saldo fantasma.
 */

create table if not exists order_crossdock (
  id uuid primary key default gen_random_uuid(),
  order_line_id uuid not null references order_line on delete cascade,
  product_id uuid not null references product on delete restrict,
  lpn_id uuid references lpn on delete restrict,
  -- El lote y el vencimiento de lo que se fue en el camión: hace falta para la trazabilidad
  -- y para poder sacarlo del andén con la misma llave con la que entró.
  lot text,
  expiry_date date,
  qty_base numeric(14, 3) not null check (qty_base > 0),
  from_location_id uuid not null references location on delete restrict,
  to_location_id uuid not null references location on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users on delete set null
);

create index if not exists order_crossdock_linea on order_crossdock (order_line_id);

comment on table order_crossdock is
  'Lo que pasó del andén de ingreso al de despacho sin guardarse. Cuenta como surtido, pero '
  'no es una reserva de existencia: nunca estuvo en el almacén.';

alter table order_crossdock enable row level security;

create policy order_crossdock_lectura on order_crossdock for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Qué camión necesita esto que acabo de recibir
-- ---------------------------------------------------------------------------

/**
 * Lo que le falta a cada camión abierto de un producto. Es la pregunta que decide si la
 * opción de crossdock se le muestra al operario o no.
 */
create or replace function falta_para_despacho(p_product_id uuid)
returns table (order_id uuid, etiqueta text, anden text, falta numeric)
language sql stable security definer set search_path = public as $$
  select
    o.id,
    coalesce(o.transporte, o.code),
    d.code,
    sum(ol.qty_base - coalesce(asig.qty, 0) - coalesce(cd.qty, 0))
  from sales_order o
  join order_line ol on ol.order_id = o.id and ol.product_id = p_product_id
  join dock_door d on d.id = o.dock_door_id
  left join lateral (
    select sum(a.qty_base) as qty from allocation a where a.order_line_id = ol.id
  ) asig on true
  left join lateral (
    select sum(c.qty_base) as qty from order_crossdock c where c.order_line_id = ol.id
  ) cd on true
  where o.status in ('DRAFT', 'RELEASED', 'PICKING')
  group by o.id, d.code
  having sum(ol.qty_base - coalesce(asig.qty, 0) - coalesce(cd.qty, 0)) > 0;
$$;

grant execute on function falta_para_despacho to authenticated;

-- ---------------------------------------------------------------------------
-- Pasarlo al andén de despacho
-- ---------------------------------------------------------------------------

/**
 * Manda el pallet recién recibido al andén del camión que lo espera, y cancela su guardado.
 *
 * Va el pallet entero. Si al camión le falta menos de lo que el pallet trae, no se parte
 * aquí: se guarda y se surte normal. Partir un pallet en el andén es otra operación —hay que
 * contar, dejar el resto identificado y volver a sugerir posición— y hacerla a las carreras
 * es como se pierde producto.
 *
 * `p_anden` es el andén que el operario escaneó. Va suelto porque el botón ya dice a qué
 * camión es, pero escanear el andén es lo que confirma que el pallet acabó donde dice el
 * sistema: sin eso, un toque por error manda producto a un camión que nunca lo vio.
 */
create or replace function crossdock(
  p_lpn_code text,
  p_order_id uuid,
  p_anden text default null
)
returns table (anden text, cajas numeric, etiqueta text)
language plpgsql security definer set search_path = public as $$
declare
  v_lpn lpn;
  v_stock record;
  v_order sales_order;
  v_destino uuid;
  v_anden text;
  v_falta numeric;
  v_por_caja numeric;
  v_linea record;
  v_queda numeric;
  v_toma numeric;
begin
  if not has_role('auxiliar', 'chequeador', 'montacargista', 'supervisor', 'admin') then
    raise exception 'No tienes permiso para mover inventario';
  end if;

  select * into v_lpn from lpn where code = trim(p_lpn_code);
  if not found then
    raise exception 'No hay ningún pallet con la matrícula %', trim(p_lpn_code);
  end if;

  select s.*, l.kind, p.name as producto
  into v_stock
  from stock s
  join location l on l.id = s.location_id
  join product p on p.id = s.product_id
  where s.lpn_id = v_lpn.id and s.qty_base > 0;

  if not found then
    raise exception 'El pallet % no tiene saldo', v_lpn.code;
  end if;
  if (select count(*) from stock where lpn_id = v_lpn.id and qty_base > 0) > 1 then
    raise exception 'El pallet % trae más de un lote: no se puede pasar entero', v_lpn.code;
  end if;
  if v_stock.kind <> 'staging' then
    raise exception 'El pallet % ya está guardado: para despacharlo hay que surtirlo', v_lpn.code;
  end if;

  select * into v_order from sales_order where id = p_order_id for update;
  if not found then
    raise exception 'Ese despacho no existe';
  end if;
  if v_order.status not in ('DRAFT', 'RELEASED', 'PICKING') then
    raise exception 'Ese despacho está % y ya no recibe producto', v_order.status;
  end if;

  select d.code, l.id into v_anden, v_destino
  from dock_door d
  left join location l on l.code = 'STG-' || d.code
  where d.id = v_order.dock_door_id;

  if v_destino is null then
    raise exception 'Ese despacho no tiene andén de carga con posición';
  end if;
  if p_anden is not null and upper(trim(p_anden)) not in (v_anden, 'STG-' || v_anden) then
    raise exception 'Ese camión carga en el andén %, no en %', v_anden, trim(p_anden);
  end if;

  select coalesce(sum(falta), 0) into v_falta
  from falta_para_despacho(v_stock.product_id)
  where order_id = p_order_id;

  select qty_base_units into v_por_caja
  from packaging_level where product_id = v_stock.product_id and code = 'CASE';
  v_por_caja := coalesce(v_por_caja, 1);

  if v_falta <= 0 then
    raise exception 'Ese camión no necesita %', v_stock.producto;
  end if;
  if v_falta < v_stock.qty_base then
    raise exception
      'Al camión le faltan % cajas y el pallet trae %: guárdalo y que se surta normal',
      trim_scale(v_falta / v_por_caja), trim_scale(v_stock.qty_base / v_por_caja);
  end if;

  -- El guardado ya no va a pasar, y el hueco que tenía apartado se libera.
  update location set reserved_by_task_id = null, reserved_until = null
  where reserved_by_task_id in (
    select id from task where lpn_id = v_lpn.id and type = 'PUTAWAY' and status <> 'DONE'
  );

  update task set status = 'CANCELLED'
  where lpn_id = v_lpn.id and type = 'PUTAWAY' and status not in ('DONE', 'CANCELLED');

  perform post_movement(
    'MOVE', v_stock.product_id, v_stock.qty_base, v_stock.location_id, v_destino, v_lpn.id,
    v_stock.lot, v_stock.expiry_date, null, 'Crossdock a ' || v_anden, null, null, null,
    'xdock-' || v_lpn.id::text
  );

  v_queda := v_stock.qty_base;

  for v_linea in
    select ol.id, ol.qty_base - coalesce(
      (select sum(a.qty_base) from allocation a where a.order_line_id = ol.id), 0) - coalesce(
      (select sum(c.qty_base) from order_crossdock c where c.order_line_id = ol.id), 0) as falta
    from order_line ol
    where ol.order_id = p_order_id and ol.product_id = v_stock.product_id
    order by ol.line_no
  loop
    exit when v_queda <= 0;
    continue when v_linea.falta <= 0;

    v_toma := least(v_queda, v_linea.falta);

    insert into order_crossdock (
      order_line_id, product_id, lpn_id, lot, expiry_date, qty_base,
      from_location_id, to_location_id, created_by
    )
    values (
      v_linea.id, v_stock.product_id, v_lpn.id, v_stock.lot, v_stock.expiry_date, v_toma,
      v_stock.location_id, v_destino, auth.uid()
    );

    v_queda := v_queda - v_toma;
  end loop;

  return query select v_anden, trim_scale(v_stock.qty_base / v_por_caja),
                      coalesce(v_order.transporte, v_order.code);
end;
$$;

grant execute on function crossdock to authenticated;

-- ---------------------------------------------------------------------------
-- Que el crossdock cuente como surtido
-- ---------------------------------------------------------------------------

create or replace view despacho_progreso as
  select
    o.id,
    o.code,
    o.transporte,
    o.entregas,
    o.customer,
    o.status,
    d.code as anden,
    count(ol.id)::integer as lineas,
    coalesce(sum(ol.qty_base), 0) as pedido,
    coalesce(
      (select sum(t.qty_base)
       from order_line l
       join allocation a on a.order_line_id = l.id
       join task t on t.id = a.task_id and t.status = 'DONE'
       where l.order_id = o.id),
      0
    ) + coalesce(
      (select sum(c.qty_base)
       from order_line l
       join order_crossdock c on c.order_line_id = l.id
       where l.order_id = o.id),
      0
    ) as surtido,
    (select count(*)
     from order_line l
     join allocation a on a.order_line_id = l.id
     join task t on t.id = a.task_id and t.status not in ('DONE', 'CANCELLED')
     where l.order_id = o.id)::integer as pendientes,
    coalesce(
      (select sum(c.qty_base)
       from order_line l
       join order_crossdock c on c.order_line_id = l.id
       where l.order_id = o.id),
      0
    ) as crossdock
  from sales_order o
  left join dock_door d on d.id = o.dock_door_id
  left join order_line ol on ol.order_id = o.id
  group by o.id, d.code;

grant select on despacho_progreso to authenticated;

/** Liberar ya no vuelve a apartar lo que el crossdock dejó puesto en el andén. */
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
    v_falta := v_line.qty_base - coalesce(
      (select sum(c.qty_base) from order_crossdock c where c.order_line_id = v_line.id), 0);

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

grant execute on function release_order to authenticated;

-- ---------------------------------------------------------------------------
-- Sacar el producto del andén cuando el camión se va
-- ---------------------------------------------------------------------------

/**
 * Al cerrar el camión, lo que se subió sale del inventario.
 *
 * No se vacía el andén entero —ahí puede haber producto de otro camión— sino exactamente lo
 * que este pedido llevó: cada movimiento de surtido que terminó en ese andén, y cada
 * crossdock. Así el saldo del andén queda en cero cuando el último camión del día se va, y
 * no en cero porque alguien lo borró.
 */
create or replace function despachar(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_estado order_status;
  v_pendientes integer;
  m record;
begin
  if not has_role('chequeador', 'supervisor', 'admin') then
    raise exception 'No tienes permiso para despachar';
  end if;

  select status into v_estado from sales_order where id = p_order_id for update;
  if v_estado is null then raise exception 'Ese pedido no existe'; end if;
  if v_estado = 'SHIPPED' then raise exception 'Ese camión ya salió'; end if;
  if v_estado = 'CANCELLED' then raise exception 'Ese pedido está anulado'; end if;

  -- Sin liberar no hay tareas, y sin tareas la cuenta de pendientes da cero: un borrador
  -- pasaria el filtro de abajo y saldria sin que nadie lo surtiera.
  if v_estado = 'DRAFT' then
    raise exception 'Ese pedido todavía no se ha liberado a surtido';
  end if;

  select pendientes into v_pendientes from despacho_progreso where id = p_order_id;
  if coalesce(v_pendientes, 0) > 0 then
    raise exception 'Faltan % tareas de surtido por terminar', v_pendientes;
  end if;

  for m in
    select
      'surtido-' || sm.id::text as clave,
      sm.product_id, sm.qty_base, sm.to_location_id, sm.lpn_id, sm.lot,
      sm.expiry_date, sm.packaging_level_id
    from stock_movement sm
    where sm.type = 'PICK'
      and sm.task_id in (
        select a.task_id
        from order_line l
        join allocation a on a.order_line_id = l.id
        where l.order_id = p_order_id and a.task_id is not null
      )
    union all
    select
      'xdock-' || c.id::text,
      c.product_id, c.qty_base, c.to_location_id, c.lpn_id, c.lot,
      c.expiry_date, null::uuid
    from order_line l
    join order_crossdock c on c.order_line_id = l.id
    where l.order_id = p_order_id
  loop
    perform post_movement(
      'SHIP', m.product_id, m.qty_base, m.to_location_id, null, m.lpn_id,
      m.lot, m.expiry_date, 'VENTA', null, m.packaging_level_id, null, null,
      'ship-' || m.clave
    );
  end loop;

  update sales_order set status = 'SHIPPED', shipped_at = now() where id = p_order_id;
end;
$$;

grant execute on function despachar(uuid) to authenticated;

/**
 * Los camiones a los que este pallet les cabe entero.
 *
 * Es lo que decide si el operario ve la opción. Filtra por `falta >= lo que trae el pallet`
 * a propósito: ofrecer un crossdock que la función va a rechazar es peor que no ofrecerlo.
 */
create or replace function crossdock_posible(p_lpn_code text)
returns table (order_id uuid, etiqueta text, anden text, faltan_cajas numeric)
language sql stable security definer set search_path = public as $$
  select f.order_id, f.etiqueta, f.anden,
         trim_scale(f.falta / coalesce(pl.qty_base_units, 1))
  from lpn l
  join stock s on s.lpn_id = l.id and s.qty_base > 0
  join location loc on loc.id = s.location_id and loc.kind = 'staging'
  join falta_para_despacho(s.product_id) f on true
  left join packaging_level pl on pl.product_id = s.product_id and pl.code = 'CASE'
  where l.code = trim(p_lpn_code)
    and f.falta >= s.qty_base
  order by f.anden;
$$;

grant execute on function crossdock_posible to authenticated;
