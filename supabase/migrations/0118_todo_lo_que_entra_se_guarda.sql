/**
 * Se quita el crossdock: todo lo que entra se guarda.
 *
 * La operación decidió que el caso no va a pasar. El producto que entra pasa a almacén, se
 * guarda en la posición que sugiere el motor —con su clase ABC y su afinidad— y sale por
 * surtido, apartado por FEFO. No hay atajo del andén de ingreso al de despacho.
 *
 * Se puede borrar de raíz y no a medias porque **nunca se usó**: `order_crossdock` tiene cero
 * filas y no hay un solo movimiento con nota de crossdock. No hay historial que conservar, así
 * que no queda ni la tabla ni la columna de la vista que la sumaba.
 *
 * Y de paso el crossdock era el único camino que esquivaba las dos reglas del almacén: un
 * pallet que se iba al andén contaba como surtido sin que nadie mirara el vencimiento y sin
 * pasar por la colocación. Quitarlo deja un solo camino, que es el que sí las cumple.
 *
 * **Lo que no se toca.** El oficio de andén `CROSSDOCK` —«Despacho a cross», los andenes
 * AND-05 a AND-08— es otra cosa: es un canal de despacho, con cuatro andenes activos y
 * pedidos encima. Comparte la palabra y nada más.
 *
 * Lo que se va:
 *
 *   - `crossdock()`, `crossdock_posible()` y `falta_para_despacho()`. La última existía sólo
 *     para decidir si se le ofrecía la opción al operario.
 *   - La tabla `order_crossdock` y la columna `crossdock` de `despacho_progreso`.
 *   - El área virtual `CROSSDOCK` y su tipo. Nunca tuvo una posición asignada.
 *
 * Y siete objetos que restaban o sumaban el crossdock se vuelven a declarar sin él, cada uno
 * desde su versión vigente: `apartar_linea` (0114), `surtido_de_linea` (0114),
 * `falta_del_camion` (0052), `faltante_de_despachos` (0051), `recontar` (0110), `despachar`
 * (0109) y `corregir_recibo` (0103). Es la misma aritmética con un término menos: lo pedido
 * menos lo apartado.
 */

-- ---------------------------------------------------------------------------
-- 1. Lo que al camión le falta ya es sólo pedido menos apartado
-- ---------------------------------------------------------------------------

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
    - coalesce((select sum(a.qty_base) from allocation a where a.order_line_id = v_line.id), 0);

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

/** Lo que al camión le falta por apartar, en unidades base. Cero quiere decir completo. */
create or replace function falta_del_camion(p_order_id uuid) returns numeric
language sql stable security definer set search_path = public as $f$
  select coalesce(sum(
    l.qty_base
    - coalesce((select sum(a.qty_base) from allocation a where a.order_line_id = l.id), 0)
  ), 0)
  from order_line l where l.order_id = p_order_id;
$f$;

/**
 * La lista de la que sale el reabastecimiento de picking: cada línea que no se pudo apartar
 * completa es producto que hay en el almacén pero no donde se saca.
 */
create or replace function faltante_de_despachos()
returns table (
  product_id uuid,
  sku text,
  nombre text,
  falta numeric,
  camiones bigint
)
language sql stable security definer set search_path = public as $f$
  select p.id, p.sku, p.name,
         sum(l.qty_base - coalesce(ap.apartado, 0)) as falta,
         count(distinct l.order_id) as camiones
  from order_line l
  join sales_order o on o.id = l.order_id
  join product p on p.id = l.product_id
  left join lateral (
    select sum(a.qty_base) as apartado from allocation a where a.order_line_id = l.id
  ) ap on true
  where o.status in ('RELEASED', 'PICKING')
    and l.qty_base - coalesce(ap.apartado, 0) > 0
  group by p.id, p.sku, p.name
  order by falta desc;
$f$;

/** Lo que de verdad bajó al andén de esa línea. Ya sólo hay un camino: el surtido. */
create or replace function surtido_de_linea(p_order_line_id uuid) returns numeric
language sql stable security definer set search_path = public as $f$
  select coalesce((
    select sum(a.qty_base) from allocation a
    where a.order_line_id = p_order_line_id
      and exists (
        select 1 from stock_movement sm where sm.task_id = a.task_id and sm.type = 'PICK'
      )
  ), 0);
$f$;

grant execute on function apartar_linea, falta_del_camion, faltante_de_despachos,
  surtido_de_linea to authenticated;

-- ---------------------------------------------------------------------------
-- 2. La vista del camión, sin la columna que contaba el crossdock
-- ---------------------------------------------------------------------------

/**
 * Va con `drop` y no con `create or replace`: replace no deja quitar una columna, y
 * `crossdock` estaba en medio. Ninguna pantalla la leía.
 */
drop view if exists despacho_progreso;

create view despacho_progreso as
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
    ) as surtido,
    (select count(distinct t.id)
     from order_line l
     join allocation a on a.order_line_id = l.id
     join task t on t.id = a.task_id and t.status not in ('DONE', 'CANCELLED')
     where l.order_id = o.id)::integer as pendientes,
    -- Al final a propósito: `create or replace view` no deja meter una columna en medio, y
    -- la hoja de despacho la necesita para listar primero los camiones que SAP mandó hoy.
    o.created_at
  from sales_order o
  left join dock_door d on d.id = o.dock_door_id
  left join order_line ol on ol.order_id = o.id
  group by o.id, d.code;

grant select on despacho_progreso to authenticated;

-- ---------------------------------------------------------------------------
-- 3. El camión sale con lo que se surtió, y nada más
-- ---------------------------------------------------------------------------

create or replace function despachar(
  p_order_id uuid,
  p_forzar boolean default false,
  p_nota text default null
) returns void
language plpgsql security definer set search_path = public as $f$
declare
  v_estado order_status;
  v_pendientes integer;
  v_en_curso integer;
  v_sin_chequear integer;
  v_linea uuid;
  v_resto numeric;
  v_cabe numeric;
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

  -- Y antes de nada, que la hoja esté chequeada. La regla vivía sólo en la pantalla, que
  -- tiene el botón apagado hasta que todas las líneas están marcadas; aquí abajo no estaba,
  -- así que un camión entero surtido y sin chequear salía sin que nadie preguntara nada.
  select count(*) into v_sin_chequear
  from order_line l
  where l.order_id = p_order_id and l.checked_at is null;

  if v_sin_chequear > 0 and not p_forzar then
    raise exception 'En la hoja falta chequear %: márcalo en el andén o ciérralo con razón',
      case when v_sin_chequear = 1 then '1 línea' else v_sin_chequear || ' líneas' end;
  end if;

  -- Corto es corto, lo fuerce quien lo fuerce: si alguna línea sale por debajo de lo que
  -- pedía, hace falta decir por qué. Antes esto sólo se preguntaba al forzar, y bajar la
  -- cantidad chequeada no pasa por ahí.
  if (p_forzar or not camion_completo(p_order_id))
     and coalesce(trim(p_nota), '') = '' then
    raise exception 'Este camión sale sin todo lo que pedía: hace falta decir por qué';
  end if;

  if p_forzar then
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
  end if;

  if coalesce(trim(p_nota), '') <> '' then
    update sales_order set ship_note = trim(p_nota) where id = p_order_id;
  end if;

  for m in
    with piezas as (
      select
        l.id as order_line_id,
        'surtido-' || sm.id::text as clave,
        sm.product_id, sm.qty_base, sm.to_location_id, sm.lpn_id, sm.lot,
        sm.expiry_date, sm.packaging_level_id, sm.detached
      from order_line l
      join allocation a2 on a2.order_line_id = l.id and a2.task_id is not null
      join stock_movement sm on sm.task_id = a2.task_id and sm.type = 'PICK'
      where l.order_id = p_order_id
    )
    select
      p.order_line_id, p.clave, p.product_id, p.qty_base, p.to_location_id, p.lot,
      p.expiry_date, p.packaging_level_id,
      coalesce(
        (select l.checked_qty_base from order_line l where l.id = p.order_line_id),
        sum(p.qty_base) over (partition by p.order_line_id)
      ) as tope,
      case
        when coalesce(
          p.detached,
          -- Sin dato apuntado: se desprendió si en el andén no queda nada con esa matrícula.
          not exists (
            select 1 from stock s
            where s.location_id = p.to_location_id
              and s.product_id = p.product_id
              and s.lpn_id is not distinct from p.lpn_id
              and s.lot is not distinct from p.lot
              and s.expiry_date is not distinct from p.expiry_date
              and s.qty_base > 0
          )
        ) then null
        else p.lpn_id
      end as lpn_id
    from piezas p
    order by p.order_line_id, p.clave
  loop
    if v_linea is distinct from m.order_line_id then
      v_linea := m.order_line_id;
      v_resto := m.tope;
    end if;

    v_cabe := least(m.qty_base, greatest(v_resto, 0));

    if v_cabe > 0 then
      perform post_movement(
        'SHIP', m.product_id, v_cabe, m.to_location_id, null, m.lpn_id,
        m.lot, m.expiry_date, 'VENTA', null, m.packaging_level_id, null, null,
        'ship-' || m.clave
      );
      v_resto := v_resto - v_cabe;
    end if;
  end loop;

  update sales_order set status = 'SHIPPED', shipped_at = now() where id = p_order_id;
end;
$f$;

grant execute on function despachar(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. El recuento, sin el término que ya no existe
-- ---------------------------------------------------------------------------

create or replace function recontar(
  p_lugar text,
  p_cajas numeric,
  p_sueltas numeric default 0,
  p_pallet text default null,
  p_nota text default null,
  p_task_id uuid default null
) returns table (
  decia numeric,
  decia_sueltas numeric,
  habia numeric,
  habia_sueltas numeric,
  diferencia numeric,
  por_caja numeric,
  tareas integer,
  de_donde text,
  falta numeric
)
language plpgsql security definer set search_path = public as $f$
declare
  v_lugar text := upper(trim(coalesce(p_lugar, '')));
  v_pallet text := nullif(upper(trim(coalesce(p_pallet, ''))), '');
  v_sueltas numeric := coalesce(p_sueltas, 0);
  v_cuantos integer;
  v_lista text;
  s record;
  v_case uuid;
  v_por_caja numeric;
  v_nuevo numeric;
  v_diff numeric;
  v_libera numeric;
  v_pendiente numeric;
  v_nota text;
  v_razon text;
  v_mov bigint;
  v_lineas uuid[] := '{}';
  v_antes uuid[] := '{}';
  v_tareas integer := 0;
  v_de_donde text;
  v_falta numeric := 0;
  a record;
  ol uuid;
begin
  if not has_role('auxiliar', 'chequeador', 'montacargista', 'supervisor', 'admin') then
    raise exception 'No tienes permiso para contar';
  end if;

  -- El recuento suelto —«uy, aquí hay menos de lo que dice el sistema»— es del jefe de
  -- bodega. La tarea de conteo cíclico le cae a cualquiera. Son dos cosas distintas y hasta
  -- hoy la función no las distinguía, aunque `p_task_id` ya decía cuál es cuál.
  if p_task_id is null and not has_role('supervisor', 'admin') then
    raise exception
      'Cambiar la cantidad lo hace el jefe de bodega. Si te cayó una tarea de conteo, cuéntala desde tu lista';
  end if;
  if v_lugar = '' then
    raise exception 'Escanea el lugar';
  end if;
  if p_cajas is null or p_cajas < 0 then
    raise exception 'Escribe cuántas cajas hay, aunque sean cero';
  end if;
  if v_sueltas < 0 then
    raise exception 'Las unidades sueltas no pueden ser menos que cero';
  end if;

  if p_task_id is not null then
    if not exists (
      select 1 from task t
      where t.id = p_task_id and t.assigned_to = auth.uid()
        and t.status in ('ASSIGNED', 'IN_PROGRESS')
    ) then
      raise exception 'Esa tarea de conteo no es tuya o ya está cerrada';
    end if;
  end if;

  select count(*), string_agg(coalesce(h.lpn_code, 'suelto') || ' (' || h.sku || ')', ', ')
    into v_cuantos, v_lista
  from hay_en(v_lugar) h
  where v_pallet is null or h.lpn_code = v_pallet;

  if v_cuantos = 0 then
    raise exception 'El sistema no tiene nada en %: para meter existencia que no está en el sistema se usa la carga inicial',
      v_lugar;
  end if;
  if v_cuantos > 1 then
    raise exception 'En % hay % cosas: %. Escanea la matrícula del pallet que estás contando',
      v_lugar, v_cuantos, v_lista;
  end if;

  select * into s
  from hay_en(v_lugar) h
  where v_pallet is null or h.lpn_code = v_pallet;

  select pl.id, pl.qty_base_units into v_case, v_por_caja
  from packaging_level pl
  where pl.product_id = s.product_id and pl.code = 'CASE';

  if v_case is null then
    raise exception 'A % le falta el corrugado en el maestro: no se puede contar por cajas',
      s.sku;
  end if;

  v_nuevo := p_cajas * v_por_caja + v_sueltas;
  v_diff := v_nuevo - s.qty_base;
  v_razon := nullif(trim(coalesce(p_nota, '')), '');

  -- Si no cuadra, por qué. Un ajuste de inventario mueve el saldo igual que un despacho
  -- corto, y despachar corto pide razón desde el primer día. Si cuadra no se pregunta nada:
  -- contar y confirmar es lo normal y no hay nada que explicar.
  if v_diff <> 0 and v_razon is null then
    raise exception
      'El recuento no cuadra con lo que el sistema creía: escribe por qué (se movió, se dañó, estaba mal apuntado)';
  end if;

  -- En el libro mayor van las dos cosas: lo que se movió y por qué. Leído solo, un
  -- movimiento que diga nada más «se dañó» no deja saber cuánto decía el sistema.
  if v_diff <> 0 then
    v_nota := 'Recuento: el sistema decía ' || texto_cajas(s.qty_base, v_por_caja)
      || ', y había ' || texto_cajas(v_nuevo, v_por_caja) || '. ' || v_razon;
  end if;

  -- Baja la cantidad y hay surtido apartado sobre esto: hay que soltar lo que ya no existe
  -- antes de tocar el saldo, porque lo reservado no puede pasar de lo que hay.
  if v_diff < 0 and s.qty_allocated > v_nuevo then
    v_pendiente := s.qty_allocated - v_nuevo;

    for a in
      select al.id, al.qty_base, al.order_line_id, al.task_id, t.status, t.qty_base as tarea_qty
      from allocation al
      left join task t on t.id = al.task_id
      where al.stock_id = s.stock_id
      order by
        case coalesce(t.status::text, 'SIN')
          when 'READY' then 1 when 'SIN' then 2 when 'ASSIGNED' then 3 else 4
        end,
        al.created_at desc
    loop
      exit when v_pendiente <= 0;
      v_libera := least(v_pendiente, a.qty_base);

      if v_libera >= a.qty_base then
        delete from allocation where id = a.id;
        if a.task_id is not null then
          update task
          set status = 'CANCELLED', completed_at = now(),
              closed_reason = 'Recuento: ya no hay existencia en esa posición'
          where id = a.task_id and status <> 'DONE';
        end if;
      else
        update allocation set qty_base = qty_base - v_libera where id = a.id;
        if a.task_id is not null then
          update task set qty_base = greatest(a.tarea_qty - v_libera, 1)
          where id = a.task_id and status not in ('DONE', 'CANCELLED');
        end if;
      end if;

      update stock set qty_allocated = greatest(0, qty_allocated - v_libera)
      where id = s.stock_id;

      if a.order_line_id is not null and not (a.order_line_id = any (v_lineas)) then
        v_lineas := array_append(v_lineas, a.order_line_id);
      end if;

      v_pendiente := v_pendiente - v_libera;
    end loop;
  end if;

  if v_diff < 0 then
    v_mov := post_movement(
      'COUNT', s.product_id, -v_diff, s.location_id, null, s.lpn_id, s.lot, s.expiry_date,
      'AJUSTE_CNT', v_nota, v_case, p_task_id
    );
  elsif v_diff > 0 then
    v_mov := post_movement(
      'COUNT', s.product_id, v_diff, null, s.location_id, s.lpn_id, s.lot, s.expiry_date,
      'AJUSTE_CNT', v_nota, v_case, p_task_id
    );
  end if;

  insert into stock_count (
    location_id, product_id, lpn_id, lot, expiry_date, qty_expected, qty_found,
    counted_by, task_id, movement_id, note
  ) values (
    s.location_id, s.product_id, s.lpn_id, s.lot, s.expiry_date, s.qty_base, v_nuevo,
    auth.uid(), p_task_id, v_mov, v_razon
  );

  -- De dónde sacar lo que ya no está aquí. El motor es el mismo del surtido, con sus reglas:
  -- del almacén salen pallets completos y las cajas sueltas salen de picking.
  if array_length(v_lineas, 1) > 0 then
    select coalesce(array_agg(t.id), '{}'::uuid[]) into v_antes
    from task t
    join allocation al on al.task_id = t.id
    where al.order_line_id = any (v_lineas);

    foreach ol in array v_lineas loop
      v_tareas := v_tareas + apartar_linea(ol);
    end loop;

    select string_agg(l.code || ' (' || texto_cajas(t.qty_base, v_por_caja) || ')', ', '
             order by l.code)
      into v_de_donde
    from task t
    join allocation al on al.task_id = t.id
    join location l on l.id = t.from_location_id
    where al.order_line_id = any (v_lineas) and not (t.id = any (v_antes));

    select coalesce(sum(
             greatest(
               0,
               li.qty_base
                 - coalesce((
                     select sum(x.qty_base) from allocation x where x.order_line_id = li.id
                   ), 0)
             )
           ), 0) into v_falta
    from order_line li
    where li.id = any (v_lineas);
  end if;

  return query
  select
    floor(s.qty_base / v_por_caja),
    mod(s.qty_base, v_por_caja),
    p_cajas,
    v_sueltas,
    v_diff / v_por_caja,
    v_por_caja,
    v_tareas,
    v_de_donde,
    round(v_falta / v_por_caja, 2);
end;
$f$;

grant execute on function recontar(text, numeric, numeric, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Corregir el recibo ya no tiene de qué protegerse
-- ---------------------------------------------------------------------------

/**
 * Se le cae el candado que paraba la corrección de un pallet que se había ido a crossdock. Las
 * dos guardas que quedan son las que importaban: si el pallet ya salió del andén se arregla
 * contando la posición, y si alguien ya se lo llevó a guardar, también.
 */
create or replace function corregir_recibo(p_pedido text, p_pallet_code text, p_cajas numeric)
returns numeric
language plpgsql security definer set search_path = public as $f$
declare
  v_doc inbound_doc;
  v_pal inbound_pallet;
  v_por_caja numeric;
  v_case uuid;
  v_antes numeric;
  v_ahora numeric;
  v_stock record;
  v_task task;
begin
  if not has_role('chequeador', 'supervisor', 'admin') then
    raise exception 'La cantidad recibida la corrige el que chequea el andén';
  end if;

  if p_cajas is null or p_cajas <= 0 then
    raise exception 'Si no bajó ninguna caja, el pallet no se recibió: avisa al jefe de bodega';
  end if;

  select * into v_doc from inbound_doc where id = ingreso_por_codigo(p_pedido);
  if not found then
    raise exception 'No hay ningún ingreso con el pedido %', trim(p_pedido);
  end if;

  select * into v_pal from inbound_pallet
  where doc_id = v_doc.id and upper(pallet_code) = upper(trim(p_pallet_code))
  for update;
  if not found then
    raise exception 'El pallet % no es de este pedido', trim(p_pallet_code);
  end if;
  if v_pal.received_at is null then
    raise exception 'El pallet % todavía no se ha recibido', v_pal.pallet_code;
  end if;

  select id, qty_base_units into v_case, v_por_caja from packaging_level
  where product_id = v_pal.product_id and code = 'CASE';

  -- Donde está el pallet ahora. Si no está en un andén, ya se guardó.
  select s.id, s.location_id, s.qty_base, s.qty_allocated, l.code as location_code
  into v_stock
  from stock s
  join location l on l.id = s.location_id
  where s.lpn_id = v_pal.received_lpn_id and s.qty_base > 0
  limit 1;

  if not found then
    raise exception 'De ese pallet ya no queda nada en el sistema';
  end if;
  if not exists (select 1 from dock_door d where 'STG-' || d.code = v_stock.location_code) then
    raise exception 'El pallet % ya está en %: eso se arregla contando la posición',
      v_pal.pallet_code, v_stock.location_code;
  end if;

  select * into v_task from task
  where lpn_id = v_pal.received_lpn_id and type = 'PUTAWAY'
    and status not in ('DONE', 'CANCELLED')
  order by created_at desc
  limit 1;

  if found and v_task.status <> 'READY' then
    raise exception 'Ya se llevaron el pallet % a guardar: la cantidad se arregla contando',
      v_pal.pallet_code;
  end if;

  v_antes := v_stock.qty_base;
  v_ahora := p_cajas * v_por_caja;

  if v_ahora = v_antes then
    return p_cajas;
  end if;
  if v_ahora < v_stock.qty_allocated then
    raise exception 'De ese pallet ya hay % apartadas para un camión',
      trim_scale(v_stock.qty_allocated / v_por_caja);
  end if;

  perform post_movement(
    'ADJUST', v_pal.product_id, abs(v_ahora - v_antes),
    case when v_ahora < v_antes then v_stock.location_id end,
    case when v_ahora > v_antes then v_stock.location_id end,
    v_pal.received_lpn_id, v_pal.lot, v_pal.expiry_date,
    'DIFER_RECIBO',
    'El papel decía ' || trim_scale(v_pal.qty_cases) || ' cajas y bajaron ' ||
      trim_scale(p_cajas),
    v_case, null, null, null
  );

  update inbound_pallet set received_cases = p_cajas where id = v_pal.id;

  -- Y el viaje de guardarlo lleva lo que hay, no lo que decía el papel.
  if v_task.id is not null then
    update task set qty_base = v_ahora where id = v_task.id;
  end if;

  return p_cajas;
end;
$f$;

grant execute on function corregir_recibo(text, text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Y ahora sí: se va el crossdock
-- ---------------------------------------------------------------------------

drop function if exists crossdock(text, uuid, text);
drop function if exists crossdock_posible(text);
-- Sólo servía para decidir si se ofrecía la opción. `faltante_de_despachos` cubre la pregunta
-- del reabastecimiento, que es la única que queda.
drop function if exists falta_para_despacho(uuid);

drop table if exists order_crossdock;

/**
 * El área virtual del crossdock. Nunca tuvo una posición asignada —ni ahora ni en el
 * histórico de `location_area`—, así que se borra en vez de desactivarse: un área inactiva
 * que nadie usó es ruido en la pantalla del jefe de bodega.
 */
delete from area where type_code = 'CROSSDOCK';
delete from area_type where code = 'CROSSDOCK';
