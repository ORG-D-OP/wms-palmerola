/**
 * Surtir se cuenta en cajas y sueltas, no en unidades disfrazadas de cajas.
 *
 * La pantalla de surtir tomaba `task.qty_base` —unidades— y lo pintaba como cajas, y lo que
 * la persona escribía en «Cajas que tomaste» entraba como unidades. Medido: una tarea de 456
 * unidades (19 cajas de 24), escritas 19 cajas, salieron **19 unidades** y el pedido quedó
 * corto 437. Es el mismo fallo del recuento que arregló la migración 0059, en la pantalla de
 * al lado.
 *
 * Así que `complete_pick` recibe cajas y sueltas, como `recontar`, y la conversión pasa aquí,
 * una sola vez, con el factor del producto. Y devuelve el texto ya dicho en bodega, para que
 * el recibo no vuelva a inventarse la unidad.
 *
 * De paso: el código que prueba que la persona está frente a lo correcto puede ser el de
 * barras o el **SKU**. De los 690 niveles `CASE` cargados hay 49 sin código de barras, y a
 * quien le toque uno de esos no le queda ninguna salida.
 */
create or replace function producto_por_codigo(p_codigo text) returns uuid
language sql stable set search_path = public as $$
  select coalesce(
    (
      select pl.product_id
      from barcode b
      join packaging_level pl on pl.id = b.packaging_level_id
      where b.code = trim(p_codigo)
      limit 1
    ),
    (select p.id from product p where p.sku = trim(p_codigo) limit 1)
  );
$$;

grant execute on function producto_por_codigo to authenticated;

drop function if exists complete_pick(uuid, text, numeric);

create function complete_pick(
  p_task_id uuid,
  p_barcode text,
  p_cajas numeric,
  p_sueltas numeric default 0
)
returns table (surtido numeric, pedido numeric, texto text)
language plpgsql security definer set search_path = public as $$
declare
  v_task task;
  v_alloc allocation;
  v_producto uuid;
  v_por_caja numeric;
  v_qty numeric;
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

  -- La matrícula del pallet de la tarea vale como prueba: es más específica que una caja.
  if v_task.lpn_id is not null and exists (
    select 1 from lpn where id = v_task.lpn_id and code = trim(p_barcode)
  ) then
    v_producto := v_task.product_id;
  else
    v_producto := producto_por_codigo(p_barcode);
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

  v_desprende := v_task.lpn_id is not null and coalesce(v_hay, 0) - v_qty > 0;

  select * into v_alloc from allocation where task_id = p_task_id;
  if v_alloc.id is not null then
    update stock set qty_allocated = greatest(0, qty_allocated - v_alloc.qty_base)
    where id = v_alloc.stock_id;
    update allocation set qty_base = v_qty where id = v_alloc.id;
  end if;

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
$$;

grant execute on function complete_pick to authenticated;

/** El chequeador también se queda sin salida con un producto sin código de barras. */
create or replace function verificar_linea(p_order_id uuid, p_codigo text)
returns table (linea smallint, sku text, nombre text, ya_estaba boolean)
language plpgsql security definer set search_path = public as $fn$
declare
  v_producto uuid;
  v_linea order_line;
  v_repetida boolean := false;
begin
  if not has_role('auxiliar', 'chequeador', 'montacargista', 'supervisor', 'admin') then
    raise exception 'No tienes permiso para chequear el camión';
  end if;

  v_producto := producto_por_codigo(p_codigo);

  if v_producto is null then
    raise exception 'No conozco el código %', trim(p_codigo);
  end if;

  select * into v_linea
  from order_line l
  where l.order_id = p_order_id and l.product_id = v_producto and l.checked_at is null
  order by l.line_no
  limit 1;

  if not found then
    select * into v_linea
    from order_line l
    where l.order_id = p_order_id and l.product_id = v_producto
    order by l.line_no
    limit 1;

    if not found then
      raise exception 'Ese producto no va en este camión';
    end if;
    v_repetida := true;
  else
    update order_line
    set checked_at = now(), checked_by = auth.uid()
    where id = v_linea.id;
  end if;

  return query
    select v_linea.line_no, p.sku, p.name, v_repetida
    from product p where p.id = v_producto;
end;
$fn$;
