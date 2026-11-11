/**
 * Lo que faltó se puede apartar después, sin volver a abrir el camión.
 *
 * Desde 0051 un camión se abre aunque no haya producto: lo que no alcanzó queda como faltante
 * y la hoja lo pinta en rojo. Faltaba la otra mitad del camino. `release_order` sólo acepta un
 * camión en DRAFT, así que una vez abierto no había manera de volver a apartar: se reabastecía
 * picking, el producto quedaba a la vista en la posición, y el camión seguía corto para
 * siempre. El chequeador no tenía más salida que cerrarlo forzado con una nota.
 *
 * Ahora el apartado de una línea es una función suya, `apartar_linea`, y hay dos maneras de
 * llamarla: al abrir el camión, como siempre, y después, sobre lo que quedó corto. La cuenta
 * de cuánto falta es la misma en los dos casos —pedido menos apartado menos crossdock—, así
 * que volver a pasar sobre una línea completa no hace nada y no hay forma de apartar de más.
 *
 * Quién lo dispara: hoy el supervisor, desde la lista de faltante. Cuando esté el
 * reabastecimiento de picking, lo va a llamar él al terminar de surtir la posición, que es el
 * momento en que el producto por fin está donde se saca.
 */

/**
 * Aparta lo que falte de una línea y devuelve cuántas tareas armó. Las dos reglas de la
 * bodega viven aquí: del área almacén salen pallets completos y nada más, y las cajas y
 * unidades sueltas salen del área de picking.
 */
create or replace function apartar_linea(p_order_line_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_line order_line;
  v_destino uuid;
  v_falta numeric;
  v_toma numeric;
  v_task uuid;
  v_tareas integer := 0;
  s record;
begin
  select * into v_line from order_line where id = p_order_line_id;
  if not found then
    raise exception 'Esa línea del pedido no existe';
  end if;

  select l.id into v_destino
  from sales_order o
  join dock_door d on d.id = o.dock_door_id
  join location l on l.code = 'STG-' || d.code
  where o.id = v_line.order_id;

  if v_destino is null then
    raise exception 'El pedido necesita un andén de carga';
  end if;

  v_falta := v_line.qty_base
    - coalesce((select sum(a.qty_base) from allocation a where a.order_line_id = v_line.id), 0)
    - coalesce((select sum(c.qty_base) from order_crossdock c where c.order_line_id = v_line.id), 0);

  if v_falta <= 0 then
    return 0;
  end if;

  -- Primera pasada: pallets enteros de almacén, sin partir ninguno.
  for s in
    select st.id, st.location_id, st.lot, st.expiry_date, st.lpn_id, st.qty_base as libre,
           coalesce(lo.level, 0) as nivel
    from stock st
    join location lo on lo.id = st.location_id
    join location_usage u on u.code = lo.usage_code
    join location_area lar on lar.location_id = lo.id and lar.valid_to is null
    join area a on a.id = lar.area_id
    where st.product_id = v_line.product_id
      and st.qty_allocated = 0
      and st.qty_base > 0
      and st.lpn_id is not null
      and a.code = 'ALMACEN'
      and u.holds_product
      and a.is_active
    order by st.expiry_date nulls last, lo.depth_index, coalesce(lo.level, 0), lo.code
  loop
    exit when v_falta <= 0;
    continue when s.libre > v_falta;

    update stock set qty_allocated = qty_base where id = s.id;

    insert into task (
      type, product_id, qty_base, packaging_level_id, lpn_id, lot, expiry_date,
      from_location_id, to_location_id, priority, min_level, flow
    )
    values (
      'PICK', v_line.product_id, s.libre, v_line.packaging_level_id, s.lpn_id, s.lot,
      s.expiry_date, s.location_id, v_destino, 200, s.nivel, 'OUTBOUND'
    )
    returning id into v_task;

    insert into allocation (order_line_id, stock_id, qty_base, task_id)
    values (v_line.id, s.id, s.libre, v_task);

    v_falta := v_falta - s.libre;
    v_tareas := v_tareas + 1;
  end loop;

  -- Segunda pasada: lo que ya no llena un pallet sale de picking, y sólo de picking.
  for s in
    select st.id, st.location_id, st.lot, st.expiry_date, st.lpn_id,
           st.qty_base - st.qty_allocated as libre,
           coalesce(lo.level, 0) as nivel
    from stock st
    join location lo on lo.id = st.location_id
    join location_usage u on u.code = lo.usage_code
    join location_area lar on lar.location_id = lo.id and lar.valid_to is null
    join area a on a.id = lar.area_id
    where st.product_id = v_line.product_id
      and st.qty_base > st.qty_allocated
      and u.holds_product
      and a.code = 'PICKING'
      and a.is_active
    order by
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

  -- Lo que quede sin apartar es el faltante. No se levanta excepción: el camión se abre
  -- igual, la hoja lo pinta, y `apartar_lo_que_falta` lo vuelve a intentar cuando haya.
  return v_tareas;
end;
$$;

create or replace function release_order(p_order_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_order sales_order;
  v_line order_line;
  v_tareas integer := 0;
begin
  if not has_role('auxiliar', 'chequeador', 'montacargista', 'supervisor', 'admin') then
    raise exception 'No tienes permiso para abrir un despacho';
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

  for v_line in select * from order_line where order_id = p_order_id order by line_no loop
    v_tareas := v_tareas + apartar_linea(v_line.id);
  end loop;

  update sales_order set status = 'RELEASED', released_at = now() where id = p_order_id;
  return v_tareas;
end;
$$;

/**
 * Vuelve a apartar lo que quedó corto en los camiones que ya se abrieron. Sin argumento pasa
 * sobre todos, que es lo que se quiere después de reabastecer: el supervisor no tiene por qué
 * ir camión por camión acordándose de cuál estaba corto.
 *
 * El orden importa. Se atienden primero los camiones que se abrieron antes, porque si lo que
 * entró a picking no alcanza para todos, el que lleva más tiempo esperando es el que sale.
 */
create or replace function apartar_lo_que_falta(p_order_id uuid default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_line record;
  v_tareas integer := 0;
begin
  if not has_role('auxiliar', 'chequeador', 'montacargista', 'supervisor', 'admin') then
    raise exception 'No tienes permiso para apartar producto';
  end if;

  if p_order_id is not null then
    perform 1 from sales_order
    where id = p_order_id and status in ('RELEASED', 'PICKING');
    if not found then
      raise exception 'Ese camión no está abierto a surtido';
    end if;
  end if;

  for v_line in
    select l.id
    from order_line l
    join sales_order o on o.id = l.order_id
    where o.status in ('RELEASED', 'PICKING')
      and (p_order_id is null or o.id = p_order_id)
    order by o.released_at, l.line_no
  loop
    v_tareas := v_tareas + apartar_linea(v_line.id);
  end loop;

  return v_tareas;
end;
$$;

grant execute on function apartar_linea, release_order, apartar_lo_que_falta to authenticated;

/** Lo que al camión le falta por apartar, en unidades base. Cero quiere decir completo. */
create or replace function falta_del_camion(p_order_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(
    l.qty_base
    - coalesce((select sum(a.qty_base) from allocation a where a.order_line_id = l.id), 0)
    - coalesce((select sum(c.qty_base) from order_crossdock c where c.order_line_id = l.id), 0)
  ), 0)
  from order_line l where l.order_id = p_order_id;
$$;

grant execute on function falta_del_camion to authenticated;

/**
 * Un camión corto no está surtido.
 *
 * El disparador daba por surtido el camión cuando terminaba la última tarea, y las tareas se
 * arman sólo de lo que se pudo apartar: un camión al que le faltan 15 cajas armaba una tarea,
 * se terminaba, y quedaba en PICKED como si estuviera completo. Dos cosas se rompían con eso:
 * la hoja decía surtido con el hueco adentro, y `apartar_lo_que_falta` ya no lo alcanzaba, así
 * que reabastecer picking no servía de nada para ese camión.
 *
 * Ahora se queda abierto mientras falte algo. La salida sigue siendo la misma de siempre:
 * cuando se decide que salga así, `despachar` con razón escrita.
 */
create or replace function marcar_pedido_surtido() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update sales_order o set status = 'PICKED'
  where o.status in ('RELEASED', 'PICKING')
    and exists (
      select 1 from order_line l join allocation a on a.order_line_id = l.id
      where l.order_id = o.id and a.task_id = new.id
    )
    and not exists (
      select 1
      from order_line l
      join allocation a on a.order_line_id = l.id
      join task t on t.id = a.task_id
      where l.order_id = o.id and t.status not in ('DONE', 'CANCELLED')
    )
    and falta_del_camion(o.id) <= 0;
  return null;
end;
$$;

/**
 * Y sacarlo corto se decide, no se escapa.
 *
 * `despachar` sólo miraba las tareas abiertas, así que un camión sin una sola tarea pendiente
 * pero con producto faltante salía como si estuviera completo y nadie firmaba el hueco. Un
 * faltante pesa lo mismo que una tarea a medias: hace falta la razón.
 */
create or replace function despachar(p_order_id uuid, p_forzar boolean default false, p_nota text default null)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_estado order_status;
  v_pendientes integer;
  v_en_curso integer;
  m record;
  a record;
begin
  if not has_role('chequeador', 'supervisor', 'admin') then
    raise exception 'No tienes permiso para despachar';
  end if;

  select status into v_estado from sales_order where id = p_order_id for update;
  if v_estado is null then raise exception 'Ese camión no existe'; end if;
  if v_estado = 'SHIPPED' then raise exception 'Ese camión ya salió'; end if;
  if v_estado = 'CANCELLED' then raise exception 'Ese camión está anulado'; end if;
  if v_estado = 'DRAFT' then
    raise exception 'Ese camión todavía no se ha abierto a surtido';
  end if;

  select pendientes into v_pendientes from despacho_progreso where id = p_order_id;

  if coalesce(v_pendientes, 0) > 0 and not p_forzar then
    raise exception 'Faltan % tareas de surtido por terminar', v_pendientes;
  end if;

  if falta_del_camion(p_order_id) > 0 and not p_forzar then
    raise exception 'Al camión le faltan % por apartar: reabastece picking o ciérralo con razón',
      trim_scale(falta_del_camion(p_order_id));
  end if;

  if p_forzar then
    if coalesce(trim(p_nota), '') = '' then
      raise exception 'Para cerrar un camión incompleto hace falta decir por qué';
    end if;

    select count(*) into v_en_curso
    from order_line l
    join allocation al on al.order_line_id = l.id
    join task t on t.id = al.task_id
    where l.order_id = p_order_id and t.status = 'IN_PROGRESS';

    if v_en_curso > 0 then
      raise exception 'Alguien anda surtiendo algo de este camión. Espera a que lo deje';
    end if;

    -- Lo apartado y no surtido se suelta: ese producto no se puede quedar reservado para un
    -- camión que ya se fue.
    for a in
      select al.id, al.stock_id, al.qty_base, al.task_id
      from order_line l
      join allocation al on al.order_line_id = l.id
      join task t on t.id = al.task_id
      where l.order_id = p_order_id and t.status in ('READY', 'ASSIGNED', 'BLOCKED')
    loop
      update stock set qty_allocated = greatest(qty_allocated - a.qty_base, 0)
      where id = a.stock_id;
      update task set status = 'CANCELLED' where id = a.task_id;
      delete from allocation where id = a.id;
    end loop;

    update sales_order set ship_note = trim(p_nota) where id = p_order_id;
  end if;

  for m in
    select
      'surtido-' || sm.id::text as clave,
      sm.product_id, sm.qty_base, sm.to_location_id, sm.lpn_id, sm.lot,
      sm.expiry_date, sm.packaging_level_id
    from stock_movement sm
    where sm.type = 'PICK'
      and sm.task_id in (
        select a2.task_id
        from order_line l
        join allocation a2 on a2.order_line_id = l.id
        where l.order_id = p_order_id and a2.task_id is not null
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
$fn$;

grant execute on function despachar to authenticated;
