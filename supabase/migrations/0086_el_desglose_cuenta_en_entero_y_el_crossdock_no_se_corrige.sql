/**
 * Dos remates de las dos anteriores.
 *
 * **El desglose por persona no devolvía nada.** Las dos columnas nuevas de la 0084 se declaran
 * `bigint` y se llenan con un `sum()` sobre `bigint`, que en Postgres devuelve `numeric`: la
 * función levantaba «structure of query does not match function result type» y la pantalla de
 * indicadores se quedaba sin el desglose entero. Son cuentas de líneas y de pallets, así que
 * van en entero.
 */
drop function if exists kpi_por_persona(date, date);

create or replace function kpi_por_persona(p_desde date default null, p_hasta date default null)
returns table (
  profile_id uuid,
  nombre text,
  rol user_role,
  tareas bigint,
  cajas numeric,
  horas_turno numeric,
  horas_trabajando numeric,
  improductivo_pct numeric,
  cajas_por_hora numeric,
  turnos_calculados bigint,
  lineas_chequeadas bigint,
  pallets_recibidos bigint
)
language plpgsql security definer set search_path = public as $f$
declare
  v_hasta date;
  v_desde date;
begin
  if not has_role('supervisor', 'admin', 'solo_lectura') then
    raise exception 'Los números de cada persona los ve el jefe de bodega';
  end if;

  v_hasta := coalesce(p_hasta, (now() at time zone reloj_de_bodega())::date);
  v_desde := coalesce(p_desde, v_hasta - 6);
  if v_hasta < v_desde then
    raise exception 'El rango de fechas está al revés';
  end if;

  return query
  with trabajo as (
    select k.assigned_to as id, count(*) as tareas, sum(k.cajas) as cajas,
           sum(k.minutos) / 60 as horas
    from kpi_tarea k
    where k.dia between v_desde and v_hasta
    group by k.assigned_to
  ),
  turnos as (
    select s.profile_id as id, sum(s.horas) as horas
    from kpi_turno_dia s
    where s.dia between v_desde and v_hasta
    group by s.profile_id
  ),
  calculados as (
    select sa.profile_id as id, count(*) as turnos
    from shift_assignment sa
    where sa.auto_closed
      and ((sa.started_at at time zone reloj_de_bodega())::date) between v_desde and v_hasta
    group by sa.profile_id
  ),
  anden as (
    select a.profile_id as id,
           sum(a.lineas_chequeadas)::bigint as lineas,
           sum(a.pallets_recibidos)::bigint as pallets
    from kpi_andenes a
    where a.dia between v_desde and v_hasta
    group by a.profile_id
  )
  select
    p.id,
    p.full_name,
    p.role,
    coalesce(t.tareas, 0),
    round(coalesce(t.cajas, 0), 1),
    round(coalesce(h.horas, 0), 1),
    round(coalesce(t.horas, 0), 1),
    -- Y a quien trabajó el andén sin una sola tarea no se le pone porcentaje: su trabajo no se
    -- mide en minutos de tarea, así que un 100 % de improductivo sería una cifra inventada.
    case when coalesce(h.horas, 0) > 0
          and not (coalesce(t.tareas, 0) = 0 and coalesce(d.lineas, 0) + coalesce(d.pallets, 0) > 0)
         then greatest(round(100 - coalesce(t.horas, 0) / h.horas * 100), 0) end,
    case when coalesce(h.horas, 0) > 0
         then round(coalesce(t.cajas, 0) / h.horas, 1) end,
    coalesce(c.turnos, 0),
    coalesce(d.lineas, 0),
    coalesce(d.pallets, 0)
  from profile p
  left join trabajo t on t.id = p.id
  left join turnos h on h.id = p.id
  left join calculados c on c.id = p.id
  left join anden d on d.id = p.id
  where t.id is not null or h.id is not null or d.id is not null
  order by coalesce(t.cajas, 0) desc, coalesce(d.lineas, 0) desc, p.full_name;
end;
$f$;

grant execute on function kpi_por_persona to authenticated;

/**
 * **Y un pallet que se fue a crossdock ya no se corrige aquí.**
 *
 * La 0085 deja corregir las cajas mientras el pallet siga en un andén y nadie se haya llevado
 * la tarea de guardarlo. El crossdock cumple las dos cosas por un camino distinto: mueve el
 * pallet del andén de recibo al de carga y **cancela** la tarea de guardarlo, así que las dos
 * guardas pasan. Pero a esas alturas la cantidad ya está prometida a una línea de un camión, y
 * bajarla por detrás dejaría a `despachar` intentando sacar más de lo que hay.
 *
 * Donde se corrige es en el andén de carga, chequeando el camión, que es la pantalla que ya
 * sabe de cantidades prometidas.
 */
create or replace function corregir_recibo(
  p_pedido text,
  p_pallet_code text,
  p_cajas numeric
) returns numeric
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

  select * into v_doc from inbound_doc
  where ltrim(pedido, '0') = ltrim(trim(p_pedido), '0');
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

  if exists (select 1 from order_crossdock c where c.lpn_id = v_pal.received_lpn_id) then
    raise exception
      'El pallet % se fue a crossdock: la cantidad se corrige chequeando el camión',
      v_pal.pallet_code;
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
