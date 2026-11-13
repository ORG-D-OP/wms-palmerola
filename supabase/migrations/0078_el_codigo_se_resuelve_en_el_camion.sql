/**
 * El código de barras se resuelve **dentro del camión**, y una línea no se chequea vacía.
 *
 * Dos fallos que salieron probando a clic, y que son el mismo descuido visto de dos lados: la
 * hoja de chequeo mira el código y no mira la carga.
 *
 * **El primero.** En el camión `SINT-TAB020`, cuya única línea es `60340.4 Ranchitas Nacho
 * Pizza`, se escaneó el código de caja de ese mismo producto y la pantalla contestó «ese
 * producto no va en este camión». Y sí va. El código `10750894603401` está en el maestro
 * **dos veces**, en dos productos distintos, y `producto_por_codigo` lo resolvía con un
 * `limit 1` sin orden: devolvía el que Postgres encontrara primero, que era el otro.
 *
 * Medido en la base: **81 códigos repetidos** entre 175 productos, y —esto es lo que no se
 * había visto— **60 de los 81 juntan variantes con distinta cantidad por caja**: el mismo
 * código vale para cajas de 192 y de 240 unidades. La vista `barcode_conflict` de la 0023 sólo
 * llamaba conflicto a que el código apuntara a dos productos **base** distintos —de eso hay
 * 2—, dando por inofensivas las variantes del mismo producto. Vale mientras sean
 * intercambiables, y con distinto tamaño de caja no lo son: el producto se parece, las
 * unidades no cuadran.
 *
 * El arreglo no es desempatar el maestro, que no se puede desde aquí: es **no preguntarle al
 * maestro**. En el chequeo, el código se busca entre las líneas **de ese camión**; en el
 * surtido, contra el producto **de esa tarea**. Los gemelos dejan de estorbar porque la
 * pregunta deja de ser «qué producto es éste» y pasa a ser «¿es éste el que espero?», que
 * tiene una sola respuesta.
 *
 * **El segundo.** Se abrió el camión `SINT-TAB009` —liberado y **sin surtir una sola caja**—,
 * se escaneó una de sus líneas y quedó «✅ 3 cajas · sin surtir». Chequeado y sin surtir a la
 * vez, con el producto en ningún lado y las cuatro tareas de surtido abiertas. Que un escaneo
 * dé por chequeada la línea entera ya estaba apuntado y es otra cosa; esto es que la marca se
 * puede poner **cuando no hay nada**: no es que falte precisión, es que no había contra qué
 * comparar.
 *
 * Ahora se mira lo surtido **de esa línea** —sus movimientos de surtido más lo que entró por
 * crossdock—, no la existencia del andén: ocho andenes se reparten los pedidos y en uno puede
 * haber producto del camión de al lado. Lo que no hace es exigir el chequeo para que el camión
 * salga; eso sigue siendo de quien lo cierra.
 */
create or replace function productos_por_codigo(p_codigo text) returns setof uuid
language sql stable set search_path = public as $f$
  -- Todos los productos que llevan ese código, no uno. Con el maestro como está, un código de
  -- caja puede ser de varios, y quien pregunta sabe cuál espera.
  select distinct pl.product_id
  from barcode b
  join packaging_level pl on pl.id = b.packaging_level_id
  where b.code = trim(p_codigo)
  union
  select p.id from product p where p.sku = trim(p_codigo);
$f$;

grant execute on function productos_por_codigo to authenticated;

create or replace function verificar_linea(p_order_id uuid, p_codigo text)
returns table (linea smallint, sku text, nombre text, ya_estaba boolean)
language plpgsql security definer set search_path = public as $f$
declare
  v_linea order_line;
  v_surtido numeric;
  v_repetida boolean := false;
begin
  if not has_role('auxiliar', 'chequeador', 'montacargista', 'supervisor', 'admin') then
    raise exception 'No tienes permiso para chequear el camión';
  end if;

  /**
   * De las líneas de este camión, la que lleva ese código y todavía no está marcada. Si todas
   * las que lo llevan ya están marcadas, se devuelve una para avisar de que se repitió.
   */
  select * into v_linea
  from order_line l
  where l.order_id = p_order_id
    and l.product_id in (select productos_por_codigo(p_codigo))
  order by (l.checked_at is not null), l.line_no
  limit 1;

  if not found then
    -- Distinguir el código que nadie conoce del que no va en este camión: son dos cosas.
    if not exists (select 1 from productos_por_codigo(p_codigo)) then
      raise exception 'No conozco el código %', trim(p_codigo);
    end if;
    raise exception 'Ese producto no va en este camión';
  end if;

  v_repetida := v_linea.checked_at is not null;

  if not v_repetida then
    select
      coalesce((
        select sum(sm.qty_base) from allocation a
        join stock_movement sm on sm.task_id = a.task_id and sm.type = 'PICK'
        where a.order_line_id = v_linea.id
      ), 0)
      + coalesce((
        select sum(c.qty_base) from order_crossdock c where c.order_line_id = v_linea.id
      ), 0)
      into v_surtido;

    if v_surtido <= 0 then
      raise exception 'De % no hay nada surtido todavía: no se puede chequear lo que no bajó',
        (select p.name from product p where p.id = v_linea.product_id);
    end if;

    update order_line
    set checked_at = now(), checked_by = auth.uid()
    where id = v_linea.id;
  end if;

  return query
    select v_linea.line_no, p.sku, p.name, v_repetida
    from product p where p.id = v_linea.product_id;
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
  -- Si **alguno** de los productos que llevan ese código es el de esta tarea, es éste. Antes
  -- se resolvía el código en todo el maestro y se quedaba con un gemelo cualquiera: si salía
  -- el otro, la pantalla decía «ese no es el producto de esta tarea» con el producto en la
  -- mano, y la única salida era teclear el SKU.
  elsif v_task.product_id in (select productos_por_codigo(p_barcode)) then
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
$f$;
