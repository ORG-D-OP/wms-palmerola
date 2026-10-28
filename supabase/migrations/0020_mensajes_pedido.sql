-- Los mensajes de liberación los lee el supervisor en pantalla: van con acentos y
-- sin los decimales que arrastra numeric(14,3).
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
             st.qty_base - st.qty_allocated as libre
      from stock st
      join location lo on lo.id = st.location_id
      join lane la on la.id = lo.lane_id
      join zone z on z.id = la.zone_id
      where st.product_id = v_line.product_id
        and st.qty_base > st.qty_allocated
        and z.kind in ('floor', 'rack')
      order by st.expiry_date nulls last, lo.depth_index, lo.pick_sequence nulls last, lo.code
    loop
      exit when v_falta <= 0;

      v_toma := least(v_falta, s.libre);
      update stock set qty_allocated = qty_allocated + v_toma where id = s.id;

      insert into task (
        type, product_id, qty_base, packaging_level_id, lpn_id, lot, expiry_date,
        from_location_id, to_location_id, priority
      )
      values (
        'PICK', v_line.product_id, v_toma, v_line.packaging_level_id, s.lpn_id, s.lot,
        s.expiry_date, s.location_id, v_destino, 200
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

create or replace function complete_pick(p_task_id uuid, p_barcode text, p_qty numeric)
returns table (surtido numeric, pedido numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_task task;
  v_alloc allocation;
  v_producto uuid;
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
  if p_qty <= 0 or p_qty > v_task.qty_base then
    raise exception 'La cantidad tiene que estar entre 1 y %', trim_scale(v_task.qty_base);
  end if;

  select pl.product_id into v_producto
  from barcode b join packaging_level pl on pl.id = b.packaging_level_id
  where b.code = trim(p_barcode)
  limit 1;

  if v_producto is distinct from v_task.product_id then
    raise exception 'Ese no es el producto de esta tarea';
  end if;

  -- Se libera lo apartado ANTES de mover: si no, por un instante quedaría reservado
  -- más de lo que hay en la posición y salta la restricción.
  select * into v_alloc from allocation where task_id = p_task_id;
  if v_alloc.id is not null then
    update stock set qty_allocated = greatest(0, qty_allocated - v_alloc.qty_base)
    where id = v_alloc.stock_id;
    update allocation set qty_base = p_qty where id = v_alloc.id;
  end if;

  perform post_movement(
    'PICK', v_task.product_id, p_qty, v_task.from_location_id, v_task.to_location_id,
    v_task.lpn_id, v_task.lot, v_task.expiry_date, 'VENTA', null, v_task.packaging_level_id,
    p_task_id, null, 'pick-' || p_task_id::text
  );

  update task set status = 'DONE', completed_at = now(), qty_base = p_qty
  where id = p_task_id;

  update sales_order o set status = 'PICKING'
  where o.status = 'RELEASED'
    and exists (
      select 1 from order_line ol join allocation a on a.order_line_id = ol.id
      where ol.order_id = o.id and a.task_id = p_task_id
    );

  return query select p_qty, v_task.qty_base;
end;
$$;
