/**
 * Surtir un pallet entero se confirma con la matrícula del pallet, no con una caja.
 *
 * `complete_pick` sólo aceptaba un código de barras de producto como prueba de que la
 * persona estaba frente a lo correcto. Para cajas sueltas eso es exacto; para un pallet
 * completo es absurdo: hay que romper el emplayado, sacar una caja y leerla para llevarse el
 * pallet sin abrir. La matrícula del pallet prueba lo mismo y mejor, porque identifica **ese**
 * pallet y no cualquiera de ese producto.
 *
 * Ahora que lo más común es vender pallets enteros (migración 0041), esto deja de ser un
 * detalle.
 */
create or replace function complete_pick(p_task_id uuid, p_barcode text, p_qty numeric)
returns table (surtido numeric, pedido numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_task task;
  v_alloc allocation;
  v_producto uuid;
  v_hay numeric;
  v_desprende boolean;
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

  -- La matrícula del pallet de la tarea vale como prueba: es más específica que una caja.
  if v_task.lpn_id is not null and exists (
    select 1 from lpn where id = v_task.lpn_id and code = trim(p_barcode)
  ) then
    v_producto := v_task.product_id;
  else
    select pl.product_id into v_producto
    from barcode b join packaging_level pl on pl.id = b.packaging_level_id
    where b.code = trim(p_barcode)
    limit 1;
  end if;

  if v_producto is distinct from v_task.product_id then
    raise exception 'Ese no es el producto de esta tarea';
  end if;

  select qty_base into v_hay
  from stock
  where location_id = v_task.from_location_id
    and product_id = v_task.product_id
    and lpn_id is not distinct from v_task.lpn_id
    and lot is not distinct from v_task.lot
    and expiry_date is not distinct from v_task.expiry_date;

  v_desprende := v_task.lpn_id is not null and coalesce(v_hay, 0) - p_qty > 0;

  select * into v_alloc from allocation where task_id = p_task_id;
  if v_alloc.id is not null then
    update stock set qty_allocated = greatest(0, qty_allocated - v_alloc.qty_base)
    where id = v_alloc.stock_id;
    update allocation set qty_base = p_qty where id = v_alloc.id;
  end if;

  perform post_movement(
    'PICK', v_task.product_id, p_qty, v_task.from_location_id, v_task.to_location_id,
    v_task.lpn_id, v_task.lot, v_task.expiry_date, 'VENTA', null, v_task.packaging_level_id,
    p_task_id, null, 'pick-' || p_task_id::text, v_desprende
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

grant execute on function complete_pick to authenticated;
