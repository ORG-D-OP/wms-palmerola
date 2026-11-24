-- El carril del rack es la pareja frente/fondo
--
-- La regla «un carril no mezcla dos productos ni dos lotes» es correcta: en doble profundidad
-- el pallet del fondo sale sacando primero el del frente, así que los dos tienen que ser lo
-- mismo. Lo que estaba mal era el tamaño del carril.
--
-- El WMS trataba **la corrida entera del rack** como un carril: 19 carriles de 192 y 128
-- posiciones. La planimetría del plano P4-A5 (maestro del 12/11/2026) lo dice de otra manera y
-- es la de la realidad: la profundidad es frente/fondo de **una bahía a un nivel**, y de esas
-- hay 1,408 —576 en abarrotes y 832 en snacks—. Con la corrida entera, los racks sólo caben
-- 19 productos y el resto de las posiciones quedan vivas pero inalcanzables.
--
-- Medido el 24/11/2026 con la foto de existencia de SAP del 14/11 —6,435 pallets de 377
-- productos— repartiendo con las mismas reglas y cambiando sólo la definición del carril:
--
--   carril = la corrida entera   4,725 colocados · 1,710 sin sitio ·   205 carriles
--   carril = la pareja           5,766 colocados ·   669 sin sitio · 1,290 carriles
--
-- Mil cuarenta y un pallets más, un 22%, y quedaban 1,529 posiciones de almacén vacías que
-- ningún otro producto podía tocar. Los 669 que siguen fuera sí son falta de espacio.
--
-- `lane` se queda como lo que siempre fue en el plano —la corrida, que es lo que agrupa la
-- zona y el recorrido—. Lo que cambia es que la regla de exclusividad deja de mirarla y mira
-- `location.carril`, que para el rack es la bahía a un nivel y para el piso sigue siendo el
-- carril entero, porque ahí un carril sí es un fondo de verdad.

-- La bahía ya estaba en el código (`R-ABA-L01-B01-N1-P1`), pero leerla de una cadena cada vez
-- es frágil: se guarda en su columna.
alter table location add column if not exists bay smallint;

comment on column location.bay is
  'Bahía dentro de la corrida del rack. Con el nivel forma el carril real: el frente y el '
  'fondo de una bahía a un nivel van juntos. Nulo en piso y andenes.';

update location
set bay = (substring(code from '-B([0-9]+)-'))::smallint
where bay is null and substring(code from '-B([0-9]+)-') is not null;

alter table location add column if not exists carril text
  generated always as (
    case
      when kind in ('rack_single', 'rack_double_deep')
        then lane_id::text || '/' || coalesce(bay, 0)::text || '/' || coalesce(level, 0)::text
      else lane_id::text
    end
  ) stored;

comment on column location.carril is
  'El carril de verdad para la regla de exclusividad: en rack, la bahía a un nivel (frente y '
  'fondo juntos); en piso, la corrida entera. No confundir con lane_id, que es la corrida del '
  'plano y sirve para la zona y el recorrido.';

create index if not exists location_carril on location (carril);

-- El generador de posiciones ya tenía la bahía en una variable; sólo le faltaba guardarla.
create or replace function generate_zone_locations(p_zone_code text)
returns integer language plpgsql security definer set search_path = public as $f$
declare
  s record;
  v_lane uuid;
  v_lane_no integer;
  v_depth integer;
  v_bay integer;
  v_level integer;
  v_code text;
  v_created integer := 0;
begin
  select z.id as zone_id, z.code, sp.* into s
  from zone z join zone_spec sp on sp.zone_id = z.id
  where z.code = p_zone_code;

  if not found then
    raise exception 'La zona % no tiene parámetros definidos', p_zone_code;
  end if;

  for v_lane_no in 1 .. (s.depth_columns / s.lane_depth) loop
    insert into lane (zone_id, code, depth)
    values (s.zone_id, s.code || '-L' || lpad(v_lane_no::text, 2, '0'), s.lane_depth)
    on conflict (zone_id, code) do update set depth = excluded.depth
    returning id into v_lane;

    for v_bay in 1 .. s.bays loop
      for v_level in 1 .. s.levels loop
        for v_depth in 1 .. s.lane_depth loop
          v_code := s.code
            || '-L' || lpad(v_lane_no::text, 2, '0')
            || '-B' || lpad(v_bay::text, 2, '0')
            || '-N' || v_level
            || '-P' || v_depth;

          insert into location (
            lane_id, code, barcode, kind, bay, level, depth_index,
            max_weight_kg, max_height_mm, max_pallets_stacked
          )
          values (
            v_lane, v_code, v_code,
            (case when s.lane_depth > 1 then 'rack_double_deep' else 'rack_single' end)::location_type,
            v_bay, v_level, v_depth,
            s.max_weight_kg, s.level_height_mm, s.max_pallets_stacked
          )
          on conflict (code) do nothing;

          v_created := v_created + 1;
        end loop;
      end loop;
    end loop;
  end loop;

  return v_created;
end;
$f$;

-- La colocación. Es la misma de la 0092 —las dos CTE `materialized`, que siguen siendo
-- obligatorias para que Postgres no vuelva a correlacionarlas— agrupando por carril.
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
  clase as (select clase_abc(p_product_id) as c),
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
  where l.retired_at is null
    and l.status = 'available'
    and l.reserved_by_task_id is null
    and u.holds_product
    and a.is_active
    and not tp.is_virtual
    and a.code = 'ALMACEN'
    and (p_max_level is null or coalesce(l.level, 0) <= p_max_level)
    and (l.max_weight_kg is null or e.peso is null or e.peso <= l.max_weight_kg)
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

-- Guardar el pallet. La comprobación es la misma, sobre el carril, y el aviso dice lo que pasa:
-- en rack el frente y el fondo van juntos, y eso no es obvio mirando la etiqueta.
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

-- Reordenar, igual.
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
