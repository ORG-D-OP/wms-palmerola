/**
 * Dos cosas que el modelo tenía al revés de la bodega.
 *
 * 1. **El jefe de bodega reparte la gente entre andenes** y los mueve cuando quiere. El
 *    sistema no lo sabía: la cola de guardado repartía por nivel de rack y nada más, así que
 *    a alguien parado en el andén 1 le podía caer un pallet del andén 6, al otro extremo de
 *    una nave de 120 metros. El andén se guarda en el turno, que es donde ya vive el equipo,
 *    porque es lo mismo: dónde está la persona y con qué anda.
 *
 * 2. **Lo más común es vender pallets enteros, y esos salen de almacén.** El motor de
 *    surtido prefería picking siempre, que es exactamente al revés: picking es para cajas y
 *    unidades sueltas. Un pedido de 10 pallets rompía 10 pallets en la posición de picking,
 *    que además no los tiene.
 */

alter table shift_assignment
  add column if not exists dock_door_id uuid references dock_door on delete set null;

comment on column shift_assignment.dock_door_id is
  'El andén donde el jefe de bodega puso a esta persona. Nulo = atiende toda la bodega.';

/** El jefe de bodega para a alguien en un andén, o lo suelta. */
create or replace function asignar_anden(p_profile_id uuid, p_anden text default null)
returns shift_assignment
language plpgsql security definer set search_path = public as $$
declare
  v_anden uuid;
  v_turno shift_assignment;
begin
  if not has_role('supervisor', 'admin') then
    raise exception 'Sólo el jefe de bodega reparte la gente entre andenes';
  end if;

  if nullif(trim(coalesce(p_anden, '')), '') is not null then
    select id into v_anden from dock_door where code = trim(p_anden);
    if not found then
      raise exception 'No hay ningún andén con el código %', trim(p_anden);
    end if;
  end if;

  update shift_assignment set dock_door_id = v_anden
  where profile_id = p_profile_id and ended_at is null
  returning * into v_turno;

  if not found then
    raise exception 'Esa persona no está trabajando ahora mismo';
  end if;

  return v_turno;
end;
$$;

grant execute on function asignar_anden to authenticated;

/**
 * La cola respeta el andén en el que la persona está parada.
 *
 * Sólo para guardar y surtir, que son las tareas que empiezan o terminan en un andén. Una
 * tarea de reacomodo entre racks no tiene andén y le cae a cualquiera. Y si el jefe no
 * reparte a nadie, todo sigue funcionando como antes: sin andén, toda la bodega.
 */
create or replace function claim_next_task(
  p_types task_type[] default null,
  p_zone_ids uuid[] default null
) returns task
language plpgsql security definer set search_path = public as $$
declare
  v_task task;
  v_turno shift_assignment;
  v_alcance smallint;
  v_flujo text;
  v_staging uuid;
begin
  if auth.uid() is null then
    raise exception 'Hace falta una sesión para tomar trabajo';
  end if;

  select * into v_turno
  from shift_assignment
  where profile_id = auth.uid() and ended_at is null;

  if not found then
    raise exception 'Entra a trabajo para que te toquen tareas';
  end if;
  if v_turno.paused_at is not null then
    raise exception 'Estás marcado como no disponible';
  end if;

  v_alcance := alcance_de(auth.uid());
  v_flujo := flujo_de(auth.uid());

  if v_turno.dock_door_id is not null then
    select l.id into v_staging
    from location l
    join dock_door d on d.id = v_turno.dock_door_id
    where l.code = 'STG-' || d.code;
  end if;

  update task t
  set status = 'ASSIGNED', assigned_to = auth.uid(), assigned_at = now()
  where t.id = (
    select c.id
    from task c
    where c.status = 'READY'
      and (p_types is null or c.type = any(p_types))
      and (p_zone_ids is null or c.zone_id = any(p_zone_ids))
      and coalesce(c.min_level, 0) <= v_alcance
      and (v_flujo = 'BOTH' or c.flow is null or c.flow = v_flujo)
      and (
        v_staging is null
        or c.type not in ('PUTAWAY', 'PICK')
        or v_staging in (c.from_location_id, c.to_location_id)
      )
    order by c.priority desc, c.created_at
    limit 1
    for update skip locked
  )
  returning t.* into v_task;

  return v_task;
end;
$$;

grant execute on function claim_next_task to authenticated;

/** Quién está en la bodega, con qué equipo y en qué andén lo puso el jefe. */
create or replace view disponibles as
  select
    p.id,
    p.full_name,
    p.role,
    sa.started_at,
    sa.paused_at is null as disponible,
    sa.pause_note,
    e.code as equipo,
    d.code as anden,
    d.direction as anden_lado
  from shift_assignment sa
  join profile p on p.id = sa.profile_id
  left join equipment e on e.id = sa.equipment_id
  left join dock_door d on d.id = sa.dock_door_id
  where sa.ended_at is null;

grant select on disponibles to authenticated;

/** Mi estado ahora: equipo, disponibilidad y el andén donde me pusieron. */
create or replace view mi_trabajo as
  select
    sa.profile_id,
    sa.started_at,
    sa.paused_at,
    sa.pause_note,
    sa.flow,
    e.code as equipo,
    t.name as tipo_equipo,
    t.max_level as alcance,
    d.code as anden
  from shift_assignment sa
  left join equipment e on e.id = sa.equipment_id
  left join equipment_type t on t.code = e.type_code
  left join dock_door d on d.id = sa.dock_door_id
  where sa.ended_at is null;

grant select on mi_trabajo to authenticated;

/**
 * Surtir: el pallet entero sale de almacén, las cajas de picking.
 *
 * Dos pasadas, y el orden entre ellas es toda la diferencia. La primera busca en **almacén**
 * pallets que quepan enteros en lo que falta de la línea y se los lleva completos, sin
 * tocarlos: es lo más común que se vende y es el movimiento más barato de la bodega, un
 * viaje de montacargas en vez de cincuenta de carretilla. La segunda surte el resto —lo que
 * ya no llena un pallet— y ahí sí **picking va primero**, que es para lo que existe.
 *
 * Las dos respetan FEFO, y entre dos pallets del mismo vencimiento gana el de adelante en
 * el rack de doble profundidad y el del nivel más bajo: el que cuesta menos sacar.
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
    v_falta := v_line.qty_base - coalesce(
      (select sum(c.qty_base) from order_crossdock c where c.order_line_id = v_line.id), 0);

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

    -- Segunda pasada: lo que sobra ya no llena un pallet, y eso se saca de picking.
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
