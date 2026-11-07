-- El indice de 0021 pedia mas de lo que se queria: una sola fila de existencia por pallet.
-- Pero todo movimiento deja la fila de origen en cero y crea la de destino, asi que un
-- pallet siempre pasa por tener dos filas. Guardar un pallet fallaba siempre.
drop index un_producto_por_lpn;

-- Lo que de verdad se quiere: un pallet esta en un solo lugar, con un solo producto, un
-- solo lote y un solo vencimiento. Las filas en cero son historia, no existencia.
create unique index un_lugar_por_pallet on stock (lpn_id)
  where lpn_id is not null and qty_base > 0;

/**
 * Lo que sale de un pallet y no lo vacia deja de ser parte de ese pallet: las cajas
 * sueltas que van al anden ya no estan en la estiba que sigue en el rack. Eso es
 * `p_desprende`. El movimiento si guarda de que pallet salieron, que es la trazabilidad.
 */
drop function post_movement(
  movement_type, uuid, numeric, uuid, uuid, uuid, text, date, text, text, uuid, uuid,
  text, text
);

create function post_movement(
  p_type movement_type,
  p_product_id uuid,
  p_qty numeric,
  p_from_location_id uuid default null,
  p_to_location_id uuid default null,
  p_lpn_id uuid default null,
  p_lot text default null,
  p_expiry date default null,
  p_reason_code text default null,
  p_note text default null,
  p_packaging_level_id uuid default null,
  p_task_id uuid default null,
  p_device_id text default null,
  p_idempotency_key text default null,
  p_desprende boolean default false
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_existing bigint;
  v_reason reason_code;
  v_prev text;
  v_hash text;
  v_id bigint;
begin
  if p_idempotency_key is not null then
    select id into v_existing from stock_movement where idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  if p_reason_code is not null then
    select * into v_reason from reason_code where code = p_reason_code and is_active;
    if not found then
      raise exception 'Motivo % no existe o esta inactivo', p_reason_code;
    end if;
    if v_reason.requires_note and coalesce(trim(p_note), '') = '' then
      raise exception 'El motivo % exige una nota', p_reason_code;
    end if;
  elsif p_type = 'ADJUST' then
    raise exception 'Un ajuste siempre lleva motivo';
  end if;

  -- Serializa la cadena de hash. Los movimientos son pocos por segundo, asi que no estorba.
  perform pg_advisory_xact_lock(hashtext('stock_movement_chain'));

  if p_from_location_id is not null then
    perform apply_stock_delta(
      p_from_location_id, p_product_id, p_lpn_id, p_lot, p_expiry, -p_qty
    );
  end if;

  if p_to_location_id is not null then
    perform apply_stock_delta(
      p_to_location_id, p_product_id,
      case when p_desprende then null else p_lpn_id end,
      p_lot, p_expiry, p_qty
    );
  end if;

  select hash into v_prev from stock_movement order by id desc limit 1;

  v_hash := encode(
    sha256(convert_to(
      coalesce(v_prev, '') || p_type::text || p_product_id::text || p_qty::text
        || coalesce(p_from_location_id::text, '') || coalesce(p_to_location_id::text, '')
        || coalesce(p_lot, '') || coalesce(p_expiry::text, '') || coalesce(auth.uid()::text, ''),
      'utf8'
    )),
    'hex'
  );

  insert into stock_movement (
    type, product_id, packaging_level_id, qty_base, from_location_id, to_location_id,
    lpn_id, lot, expiry_date, reason_code, note, task_id, actor_id, device_id,
    idempotency_key, prev_hash, hash
  ) values (
    p_type, p_product_id, p_packaging_level_id, p_qty, p_from_location_id, p_to_location_id,
    p_lpn_id, p_lot, p_expiry, p_reason_code, p_note, p_task_id, auth.uid(), p_device_id,
    p_idempotency_key, v_prev, v_hash
  ) returning id into v_id;

  return v_id;
end;
$$;

grant execute on function post_movement to authenticated;

/**
 * Surtido. El unico cambio frente a 0020: si la toma no vacia el pallet, lo que sale va
 * suelto al anden y el pallet se queda en su posicion con el resto.
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

  select pl.product_id into v_producto
  from barcode b join packaging_level pl on pl.id = b.packaging_level_id
  where b.code = trim(p_barcode)
  limit 1;

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
