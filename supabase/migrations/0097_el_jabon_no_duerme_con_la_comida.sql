-- El jabón no duerme con la comida
--
-- La 0096 trajo del plano el grupo de cada posición: 1,043 para lo que no es alimento —la zona
-- F1 entera y los cuatro primeros carriles del rack de abarrotería— y 4,538 para alimento. Del
-- lado del producto el dato ya existía desde el principio, `product.contamination_class`, con
-- 114 químicos, 29 no alimentos y 11 aromáticos, y no lo miraba nadie. Aquí se juntan.
--
-- La regla es de ida y vuelta, como la pide el plano: lo que no es alimento sólo entra en su
-- zona, y en su zona no entra alimento. Un producto sin clase se trata como alimento; son 23
-- en el maestro y eso es un hueco que hay que tapar en datos maestros, no aquí.
--
-- **Lo que cuesta, medido el 24/11/2026 con la foto de SAP del 14/11** (6,435 pallets de 377
-- productos), sembrando con las mismas reglas:
--
--   sin segregar   5,991 colocados ·   444 sin sitio · 377 productos con cara de picking
--   segregando     5,526 colocados ·   909 sin sitio · 352 productos con cara de picking
--
-- Cuatrocientos sesenta y cinco pallets. No es que falte espacio donde se guardan: es que
-- sobra donde no se puede. Lo que no es alimento pide 641 pallets y tiene 1,043 posiciones, así
-- que quedan 402 vacías mientras el alimento va corto. Y 25 productos que no son alimento se
-- quedan sin cara de picking, porque en su zona sólo hay 86 caras.
--
-- Por eso la regla es un parámetro del sitio y no una verdad de la base. `segrega_no_alimento`
-- se apaga y la bodega vuelve a mezclar, que es lo que hace hoy. Apagarla es una decisión de
-- calidad, no de programación.

alter table site add column if not exists segrega_no_alimento boolean not null default true;

comment on column site.segrega_no_alimento is
  'Si lo que no es alimento sólo puede guardarse en las posiciones de grupo NO_ALIMENTO, y '
  'nada más ahí. Del plano del 12/11/2026. Apagarlo recupera unos 465 pallets de capacidad y '
  'pone el jabón al lado de la comida.';

-- El grupo que le toca a un producto. Sin clase, alimento: es lo que son 513 de los 690.
create or replace function grupo_del_producto(p_product_id uuid)
returns text language sql stable security definer set search_path = public as $f$
  select case
    when (select contamination_class from product where id = p_product_id)
         in ('QUIMICO', 'NO_ALIMENTO', 'AROMATICO')
      then 'NO_ALIMENTO'
    else 'ALIMENTO'
  end;
$f$;

comment on function grupo_del_producto(uuid) is
  'ALIMENTO o NO_ALIMENTO, para comparar con location.grupo. Cuesta poco, pero vale la misma '
  'regla que clase_abc: dentro de un order by, sacarla a una CTE materialized.';

create or replace function suggest_putaway_location(
  p_product_id uuid,
  p_lot text default null,
  p_expiry date default null,
  p_max_level smallint default null
) returns uuid
language sql stable security definer set search_path = public as $f$
  with estiba as (
    select total_weight_kg as peso
    from pallet_config
    where product_id = p_product_id and is_default
    limit 1
  ),
  clase as materialized (select clase_abc(p_product_id) as c),
  grupo as materialized (
    select grupo_del_producto(p_product_id) as g,
           (select bool_or(segrega_no_alimento) from site) as separa
  ),
  ajeno as materialized (
    select distinct ol.carril
    from stock otro
    join location ol on ol.id = otro.location_id
    where otro.qty_base > 0
      and (otro.product_id <> p_product_id or otro.lot is distinct from p_lot)
  ),
  en_camino as materialized (
    select distinct ol.carril
    from location ol
    join task t on t.id = ol.reserved_by_task_id
    where t.status not in ('DONE', 'CANCELLED')
      and (t.product_id is distinct from p_product_id or t.lot is distinct from p_lot)
  )
  select l.id
  from location l
  join lane la on la.id = l.lane_id
  join location_usage u on u.code = l.usage_code
  join location_area lar on lar.location_id = l.id and lar.valid_to is null
  join area a on a.id = lar.area_id
  join area_type tp on tp.code = a.type_code
  left join stock s on s.location_id = l.id and s.qty_base > 0
  left join estiba e on true
  cross join clase
  cross join grupo
  where l.retired_at is null
    and l.status = 'available'
    and l.reserved_by_task_id is null
    and u.holds_product
    and a.is_active
    and not tp.is_virtual
    and a.code = 'ALMACEN'
    and (p_max_level is null or coalesce(l.level, 0) <= p_max_level)
    and (l.max_weight_kg is null or e.peso is null or e.peso <= l.max_weight_kg)
    and (not grupo.separa or l.grupo is null or l.grupo = grupo.g)
    and pallets_que_caben(l.id, p_product_id) > 0
    and not exists (select 1 from ajeno where ajeno.carril = l.carril)
    and not exists (select 1 from en_camino where en_camino.carril = l.carril)
  order by
    (s.product_id is not null) desc,
    coalesce(l.level, 0),
    l.pick_sequence * case when clase.c = 'C' then -1 else 1 end nulls last,
    l.code
  limit 1;
$f$;

-- Y el que escanea una posición a mano tampoco puede saltársela.
create or replace function complete_putaway(p_task_id uuid, p_location_code text)
returns table(location_code text, era_la_sugerida boolean)
language plpgsql security definer set search_path = public as $f$
declare
  v_task task;
  v_dest location;
begin
  select * into v_task from task where id = p_task_id;

  if not found then
    raise exception 'La tarea no existe';
  end if;
  if v_task.assigned_to is distinct from auth.uid() then
    raise exception 'Esa tarea no es tuya';
  end if;
  if v_task.status <> 'IN_PROGRESS' then
    raise exception 'Primero escanea el pallet';
  end if;

  select * into v_dest from location where code = trim(p_location_code);

  if not found then
    raise exception 'No existe la posición %', p_location_code;
  end if;
  if v_dest.retired_at is not null or v_dest.status <> 'available' then
    raise exception 'La posición % no está disponible', v_dest.code;
  end if;
  if v_dest.reserved_by_task_id is not null and v_dest.reserved_by_task_id <> p_task_id then
    raise exception 'La posición % está apartada para otra tarea', v_dest.code;
  end if;

  if (select bool_or(segrega_no_alimento) from site)
     and v_dest.grupo is not null
     and v_dest.grupo <> grupo_del_producto(v_task.product_id)
  then
    if v_dest.grupo = 'NO_ALIMENTO' then
      raise exception 'Ahí sólo va lo que no es alimento. Busca otro hueco';
    end if;
    raise exception 'Eso no es alimento y ahí sí. Llévalo a su zona';
  end if;

  if exists (
    select 1 from stock s join location l on l.id = s.location_id
    where l.carril = v_dest.carril and s.qty_base > 0
      and (s.product_id <> v_task.product_id or s.lot is distinct from v_task.lot)
  ) then
    if v_dest.kind in ('rack_single', 'rack_double_deep') then
      raise exception
        'El frente y el fondo de esa bahía van juntos, y ahí hay otro producto o lote. Busca otro hueco';
    end if;
    raise exception 'En ese carril hay otro producto o lote. Busca otro hueco';
  end if;

  perform post_movement(
    'PUTAWAY', v_task.product_id, v_task.qty_base, v_task.from_location_id, v_dest.id,
    v_task.lpn_id, v_task.lot, v_task.expiry_date, null, null, v_task.packaging_level_id,
    p_task_id, null, 'putaway-' || p_task_id::text
  );

  update task
  set status = 'DONE', completed_at = now(), to_location_id = v_dest.id
  where id = p_task_id;

  update location set reserved_by_task_id = null, reserved_until = null
  where reserved_by_task_id = p_task_id;

  return query select v_dest.code, v_dest.id = v_task.to_location_id;
end;
$f$;

-- Reordenar, igual: mover a mano no es una puerta de atrás.
create or replace function reordenar(p_origen text, p_destino text, p_pallet text default null)
returns table(pallet text, sku text, nombre text, cantidad numeric, de text, a text)
language plpgsql security definer set search_path = public as $f$
declare
  v_origen text := upper(trim(coalesce(p_origen, '')));
  v_pallet text := nullif(upper(trim(coalesce(p_pallet, ''))), '');
  v_dest location;
  v_cuantos integer;
  v_lista text;
  s record;
begin
  if v_origen = '' or coalesce(trim(p_destino), '') = '' then
    raise exception 'Escanea el lugar de donde sale y el lugar a donde va';
  end if;

  v_dest := destino_valido(p_destino);

  select count(*), string_agg(coalesce(h.lpn_code, 'suelto') || ' (' || h.sku || ')', ', ')
    into v_cuantos, v_lista
  from hay_en(v_origen) h
  where v_pallet is null or h.lpn_code = v_pallet;

  if v_cuantos = 0 then
    if v_pallet is not null then
      raise exception 'El pallet % no está en %', v_pallet, v_origen;
    end if;
    raise exception 'En % no hay nada que mover', v_origen;
  end if;

  if v_cuantos > 1 then
    raise exception
      'En % hay % cosas: %. Escanea la matrícula del pallet que vas a mover',
      v_origen, v_cuantos, v_lista;
  end if;

  select * into s
  from hay_en(v_origen) h
  where v_pallet is null or h.lpn_code = v_pallet;

  if s.location_id = v_dest.id then
    raise exception 'Ya está en %', v_dest.code;
  end if;
  if s.qty_allocated > 0 then
    raise exception
      'Eso está apartado para un pedido: termina el surtido o suéltalo antes de moverlo';
  end if;

  if (select bool_or(segrega_no_alimento) from site)
     and v_dest.grupo is not null
     and v_dest.grupo <> grupo_del_producto(s.product_id)
  then
    if v_dest.grupo = 'NO_ALIMENTO' then
      raise exception 'Ahí sólo va lo que no es alimento. Busca otro hueco';
    end if;
    raise exception 'Eso no es alimento y ahí sí. Llévalo a su zona';
  end if;

  if exists (
    select 1 from stock st
    join location l on l.id = st.location_id
    where l.carril = v_dest.carril and st.qty_base > 0
      and (st.product_id <> s.product_id or st.lot is distinct from s.lot)
  ) then
    if v_dest.kind in ('rack_single', 'rack_double_deep') then
      raise exception
        'El frente y el fondo de esa bahía van juntos, y ahí hay otro producto o lote. Busca otro hueco';
    end if;
    raise exception 'En ese carril hay otro producto o lote. Busca otro hueco';
  end if;

  if s.lpn_id is not null and pallets_que_caben(v_dest.id, s.product_id) <= 0 then
    raise exception 'En % no cabe otro pallet de ese producto', v_dest.code;
  end if;

  perform post_movement(
    'MOVE', s.product_id, s.qty_base, s.location_id, v_dest.id, s.lpn_id, s.lot,
    s.expiry_date, 'TRASLADO'
  );

  return query
  select coalesce(s.lpn_code, 'suelto'), s.sku, s.nombre, s.qty_base, s.location_code,
         v_dest.code;
end;
$f$;
