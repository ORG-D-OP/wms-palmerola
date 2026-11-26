/**
 * Veintiún viajes a la misma posición.
 *
 * El ZRDT trae una línea por cliente. El camión 3946128 pide 259 líneas de 107 productos: la
 * misma crema en dieciséis líneas, el mismo kétchup en nueve. Medido en producción: ese
 * camión tiene **244 tareas de surtido para 106 pallets distintos**. Ciento treinta y ocho
 * viajes a una posición donde ya se estuvo, a sacar un puñado de cajas del mismo pallet que
 * ya se tenía delante.
 *
 * Así que cuando una línea va a sacar de un pallet de picking del que **este mismo camión** ya
 * tiene una tarea sin tomar, no se crea otra: se le suma la cantidad. Un viaje, el total
 * junto. Cada línea conserva su apartado, que es lo que la hoja del chequeador enseña línea
 * por línea, y lo que decide si el camión sale completo.
 *
 * Lo que **no** se junta, a propósito:
 *
 * - **Los pallets enteros de almacén.** Dos líneas que se llevan dos pallets son dos viajes
 *   de verdad, aunque salgan de la misma posición: no caben los dos en el montacargas.
 * - **Las tareas que alguien ya tomó o empezó.** Esa persona lleva una cantidad en la cabeza
 *   y cambiársela por detrás es mandarla a buscar cajas que no sabe que le pidieron.
 * - **Dos camiones.** El destino es el andén del camión; juntarlos sería cargar el de al lado.
 *
 * Y las dos funciones que viven de eso: `complete_pick`, que ahora reparte lo tomado entre las
 * líneas de la tarea, y `surtido_de_linea`, que contaba el movimiento entero y con esto se
 * habría apuntado el total de las demás líneas en cada una.
 */

create or replace function apartar_linea(p_order_line_id uuid) returns integer
language plpgsql security definer set search_path = public as $f$
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
      and not vence_demasiado_pronto(st.expiry_date)
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
      and not vence_demasiado_pronto(st.expiry_date)
    order by
      st.expiry_date nulls last,
      lo.depth_index,
      lo.pick_sequence nulls last,
      lo.code
  loop
    exit when v_falta <= 0;

    v_task := null;
    v_toma := least(v_falta, s.libre);
    update stock set qty_allocated = qty_allocated + v_toma where id = s.id;

    /*
      ¿Ya hay una tarea de este camión que salga de este mismo pallet?

      El ZRDT trae una línea por cliente, así que un camión puede pedir veintiuna veces el
      mismo producto; si las veintiuna salen del mismo pallet de picking, veintiuna tareas son
      veintiún viajes a la misma posición a sacar un puñado de cajas cada vez. La tarea se
      reutiliza y se le suma la cantidad: un viaje, el total junto, y cada línea conserva su
      apartado, que es lo que la hoja del chequeador enseña.

      Sólo si está **READY y sin dueño**: una que alguien ya tomó o empezó lleva una cantidad
      que esa persona está contando, y cambiársela por detrás es mandarla a buscar cajas que
      no sabe que le pidieron. Y sólo dentro del mismo camión, porque el destino es el andén
      de ese camión y juntar dos camiones sería cargar el de al lado.
    */
    select t.id into v_task
    from task t
    where t.type = 'PICK'
      and t.status = 'READY'
      and t.assigned_to is null
      and t.product_id = v_line.product_id
      and t.from_location_id = s.location_id
      and t.to_location_id = v_destino
      and t.lpn_id is not distinct from s.lpn_id
      and t.lot is not distinct from s.lot
      and t.expiry_date is not distinct from s.expiry_date
      and t.packaging_level_id is not distinct from v_line.packaging_level_id
      and exists (
        select 1 from allocation a
        join order_line ol on ol.id = a.order_line_id
        where a.task_id = t.id and ol.order_id = v_line.order_id
      )
    limit 1;

    if v_task is null then
      insert into task (
        type, product_id, qty_base, packaging_level_id, lpn_id, lot, expiry_date,
        from_location_id, to_location_id, priority, min_level, flow
      )
      values (
        'PICK', v_line.product_id, v_toma, v_line.packaging_level_id, s.lpn_id, s.lot,
        s.expiry_date, s.location_id, v_destino, 200, s.nivel, 'OUTBOUND'
      )
      returning id into v_task;

      v_tareas := v_tareas + 1;
    else
      update task set qty_base = qty_base + v_toma where id = v_task;
    end if;

    insert into allocation (order_line_id, stock_id, qty_base, task_id)
    values (v_line.id, s.id, v_toma, v_task);

    v_falta := v_falta - v_toma;
  end loop;

  -- Lo que quede sin apartar es el faltante. No se levanta excepción: el camión se abre
  -- igual, la hoja lo pinta, y `apartar_lo_que_falta` lo vuelve a intentar cuando haya.
  return v_tareas;
end;
$f$;

create or replace function complete_pick(
  p_task_id uuid,
  p_barcode text,
  p_cajas numeric,
  p_sueltas numeric default 0
)
returns table (surtido numeric, pedido numeric, texto text)
language plpgsql security definer set search_path = public as $f$
declare
  v_task task;
  v_alloc allocation;
  v_por_caja numeric;
  v_qty numeric;
  v_hay numeric;
  v_desprende boolean;
  v_resto numeric;
  v_parte numeric;
begin
  select * into v_task from task where id = p_task_id;
  if not found then
    raise exception 'La tarea no existe';
  end if;
  if v_task.assigned_to is distinct from auth.uid() then
    raise exception 'Esa tarea no es tuya';
  end if;
  if v_task.status <> 'IN_PROGRESS' then
    raise exception 'Primero escanea la posición';
  end if;

  select coalesce(
    (select pl.qty_base_units from packaging_level pl
      where pl.product_id = v_task.product_id and pl.code = 'CASE'),
    1
  ) into v_por_caja;

  if coalesce(p_sueltas, 0) < 0 then
    raise exception 'Las unidades sueltas no pueden ser menos que cero';
  end if;

  v_qty := coalesce(p_cajas, 0) * v_por_caja + coalesce(p_sueltas, 0);

  if v_qty <= 0 or v_qty > v_task.qty_base then
    raise exception 'La tarea pide %. Lo que tomaste no puede pasarse de ahí',
      texto_cajas(v_task.qty_base, v_por_caja);
  end if;

  perform comprobar_codigo_de_tarea(p_task_id, p_barcode);

  select qty_base into v_hay
  from stock
  where location_id = v_task.from_location_id
    and product_id = v_task.product_id
    and lpn_id is not distinct from v_task.lpn_id
    and lot is not distinct from v_task.lot
    and expiry_date is not distinct from v_task.expiry_date;

  v_desprende := v_task.lpn_id is not null and coalesce(v_hay, 0) - v_qty > 0;

  /*
    Una tarea puede servir a varias líneas del mismo camión. Lo que se tomó se reparte entre
    ellas por orden de línea —la primera se llena antes que la segunda— y la reserva se suelta
    entera, que es lo que había apartado.

    Si se tomó de menos, las líneas que quedaron sin nada pierden su apartado en vez de
    quedarse con un cero que nadie va a surtir: `apartar_lo_que_falta` las vuelve a intentar.
  */
  v_resto := v_qty;
  for v_alloc in
    select a.* from allocation a
    join order_line ol on ol.id = a.order_line_id
    where a.task_id = p_task_id
    order by ol.line_no, a.id
  loop
    update stock set qty_allocated = greatest(0, qty_allocated - v_alloc.qty_base)
    where id = v_alloc.stock_id;

    v_parte := least(v_alloc.qty_base, v_resto);
    v_resto := v_resto - v_parte;

    if v_parte > 0 then
      update allocation set qty_base = v_parte where id = v_alloc.id;
    else
      delete from allocation where id = v_alloc.id;
    end if;
  end loop;

  perform post_movement(
    'PICK', v_task.product_id, v_qty, v_task.from_location_id, v_task.to_location_id,
    v_task.lpn_id, v_task.lot, v_task.expiry_date, 'VENTA', null, v_task.packaging_level_id,
    p_task_id, null, 'pick-' || p_task_id::text, v_desprende
  );

  update task set status = 'DONE', completed_at = now(), qty_base = v_qty
  where id = p_task_id;

  update sales_order o set status = 'PICKING'
  where o.status = 'RELEASED'
    and exists (
      select 1 from order_line ol join allocation a on a.order_line_id = ol.id
      where ol.order_id = o.id and a.task_id = p_task_id
    );

  return query select v_qty, v_task.qty_base, texto_cajas(v_qty, v_por_caja);
end;
$f$;

/**
 * Lo surtido de una línea, contado por su apartado y no por el movimiento entero.
 *
 * Sumaba `stock_movement.qty_base` de las tareas de la línea. Con una tarea por línea daba
 * igual; ahora que una tarea puede servir a varias, el movimiento es el de todas juntas y
 * cada línea se habría apuntado el total de las demás. Lo que le tocó a cada una está en su
 * `allocation`, que `complete_pick` deja con lo que se tomó de verdad; el movimiento sigue
 * mandando en **si** salió o no.
 */
create or replace function surtido_de_linea(p_order_line_id uuid) returns numeric
language sql stable security definer set search_path = public as $f$
  select coalesce((
    select sum(a.qty_base) from allocation a
    where a.order_line_id = p_order_line_id
      and exists (
        select 1 from stock_movement sm where sm.task_id = a.task_id and sm.type = 'PICK'
      )
  ), 0)
  + coalesce((
    select sum(c.qty_base) from order_crossdock c where c.order_line_id = p_order_line_id
  ), 0);
$f$;

grant execute on function surtido_de_linea to authenticated;

/**
 * Y la vista del camión, que contaba la tarea entera una vez por cada línea que sirve.
 *
 * `surtido` sumaba `task.qty_base` por cada `allocation`: con una tarea de 144 sirviendo a
 * tres líneas, el camión decía 432 surtidas de 144 pedidas. Y `pendientes`, que es cuántas
 * tareas quedan vivas, contaba tres donde hay una. Las dos cuentan ahora por lo que le tocó a
 * cada línea y por tareas distintas.
 */
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
      (select sum(a.qty_base)
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
    (select count(distinct t.id)
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
    ) as crossdock,
    -- Al final a propósito: `create or replace view` no deja meter una columna en medio, y
    -- la hoja de despacho la necesita para listar primero los camiones que SAP mandó hoy.
    o.created_at
  from sales_order o
  left join dock_door d on d.id = o.dock_door_id
  left join order_line ol on ol.order_id = o.id
  group by o.id, d.code;

grant select on despacho_progreso to authenticated;
