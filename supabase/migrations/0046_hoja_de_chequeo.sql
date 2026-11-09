/**
 * El camión se abre aunque falte producto, y la hoja se chequea escaneando.
 *
 * Tres cosas que salieron de ver cómo se despacha de verdad:
 *
 * **Que falte producto no cierra el camión.** Antes, una línea sin existencia tiraba toda la
 * liberación y no se surtía nada: veinte líneas paradas por una. Ahora se aparta lo que hay,
 * la línea corta se ve en la hoja —apartado contra pedido— y el camión sale igual si así se
 * decide.
 *
 * **La hoja es una lista de chequeo.** El chequeador ve todas las líneas con su cantidad y va
 * escaneando lo que sube al camión: cada producto escaneado queda marcado, y lo que no está
 * marcado es lo que falta. La marca se guarda en la línea y no en la pantalla, porque la hoja
 * la puede llevar uno y escanear otro, y si el teléfono se bloquea no se pierde lo hecho.
 *
 * **Cerrar incompleto es una decisión, no un accidente.** Existe, porque un camión que tiene
 * que salir sale, pero pide una razón y la guarda. Lo que quedó apartado y sin surtir se
 * suelta: si no, ese producto queda reservado para un camión que ya se fue. Lo que alguien
 * anda cargando en ese momento no se toca —una tarea en curso no se cancela nunca—, así que
 * el cierre espera a que la deje.
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

    -- Lo que no alcanzó no detiene el camión: la línea queda corta y se ve en la hoja,
    -- apartado contra pedido. Pararlo aquí dejaba las otras veinte líneas sin surtir.
  end loop;

  update sales_order set status = 'RELEASED', released_at = now() where id = p_order_id;
  return v_tareas;
end;
$$;

grant execute on function release_order to authenticated;

-- Quién marcó cada línea de la hoja, y cuándo.
alter table order_line
  add column if not exists checked_at timestamptz,
  add column if not exists checked_by uuid references profile(id) on delete set null;

-- La razón por la que un camión salió sin todo.
alter table sales_order
  add column if not exists ship_note text;

/**
 * Marcar una línea de la hoja con el código de barras de lo que subió al camión.
 *
 * Devuelve la línea para que la pantalla la pinte, y dice si ya estaba marcada: escanear dos
 * veces la misma caja es lo más fácil del mundo y no es un error, pero el operario tiene que
 * enterarse de que ese no era el que faltaba.
 */
drop function if exists verificar_linea(uuid, text);

create function verificar_linea(p_order_id uuid, p_codigo text)
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

  select pl.product_id into v_producto
  from barcode b
  join packaging_level pl on pl.id = b.packaging_level_id
  where b.code = trim(p_codigo)
  limit 1;

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

grant execute on function verificar_linea to authenticated;

/**
 * Cerrar el camión.
 *
 * `p_forzar` es la salida de emergencia: el camión se va sin todo, con la razón escrita.
 */
drop function if exists despachar(uuid);

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
