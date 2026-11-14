/**
 * El código equivocado rebotaba tres pasos después, y sin decir qué se había escaneado.
 *
 * Medido surtiendo un producto de los que no traen código de barras: se escaneó el código de
 * un parecido —de los que comparten barra—, la pantalla lo **aceptó y avanzó**, se escribió la
 * cantidad, y al Confirmar rebotó. El escaneo es el momento de decir «ése no es»; dejarlo pasar
 * hace que la persona se dé cuenta tres pasos después, y de paso pierde lo que ya tecleó.
 *
 * Y el mensaje decía «Ese no es el producto de esta tarea», sin nombrar ninguno de los dos. El
 * del pallet equivocado sí lo hace —es de los mejores que tiene la aplicación—, y éste debería
 * decir lo mismo: **qué se escaneó** y **de qué es la tarea**. Con dos productos que comparten
 * la barra y se distinguen por el gramaje, saber cuál se leyó es la mitad del trabajo.
 *
 * Así que la comprobación sale de dentro de `complete_pick` y se vuelve una función aparte, que
 * la pantalla puede llamar en el escaneo. Las dos llaman a la misma, que es lo que hace que no
 * se separen: lo que acepta el escaneo es exactamente lo que acepta el Confirmar.
 */
create or replace function producto_escaneado(p_task_id uuid, p_codigo text) returns uuid
language plpgsql stable security definer set search_path = public as $f$
declare
  v_task task;
begin
  select * into v_task from task where id = p_task_id;
  if not found then
    raise exception 'La tarea no existe';
  end if;

  -- La matrícula del pallet de la tarea vale como prueba: es más específica que una caja.
  if v_task.lpn_id is not null and exists (
    select 1 from lpn where id = v_task.lpn_id and code = trim(p_codigo)
  ) then
    return v_task.product_id;
  end if;

  -- Si **alguno** de los productos que llevan ese código es el de esta tarea, es éste. Antes
  -- se resolvía el código en todo el maestro y se quedaba con un gemelo cualquiera.
  if v_task.product_id in (select productos_por_codigo(p_codigo)) then
    return v_task.product_id;
  end if;

  return producto_por_codigo(p_codigo);
end;
$f$;

grant execute on function producto_escaneado to authenticated;

create or replace function comprobar_codigo_de_tarea(p_task_id uuid, p_codigo text)
returns void
language plpgsql stable security definer set search_path = public as $f$
declare
  v_esperado uuid;
  v_leido uuid;
begin
  select product_id into v_esperado from task where id = p_task_id;
  if v_esperado is null then
    raise exception 'La tarea no existe';
  end if;

  v_leido := producto_escaneado(p_task_id, p_codigo);

  if v_leido is distinct from v_esperado then
    raise exception 'Escaneaste %. Esta tarea es de %',
      (select p.name from product p where p.id = v_leido),
      (select p.name from product p where p.id = v_esperado);
  end if;
end;
$f$;

grant execute on function comprobar_codigo_de_tarea to authenticated;

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
$f$;
