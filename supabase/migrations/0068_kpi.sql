/**
 * Los números que los gerentes quieren ver: precisión de los despachos, cajas por hora y
 * productividad de la gente con su tiempo improductivo. No había ninguno.
 *
 * Tres decisiones que cargan con todo:
 *
 *   1. **El día es el de la bodega, no el del servidor.** Postgres corre en UTC y Honduras va
 *      seis horas atrás, así que un turno de tarde caería partido en dos días. El reloj es un
 *      dato del sitio (`site.time_zone`), no una cadena escondida en una consulta.
 *   2. **Las cajas por hora se miden contra la hora del turno**, que es la que se paga, no
 *      contra el tiempo que la tarea estuvo abierta. Y al lado va el **tiempo improductivo**,
 *      para que el número se pueda explicar en vez de sólo compararse.
 *   3. **Lo de cada persona no lo ve cualquiera.** Los totales del día son una vista abierta;
 *      el desglose con nombres va detrás de una función que exige el rango.
 */
alter table site add column if not exists time_zone text not null default 'America/Tegucigalpa';

comment on column site.time_zone is
  'El reloj de la bodega: con él se decide a qué día pertenece una tarea o un turno.';

/**
 * Y un tope al turno, que no es un detalle: medido contra la base real, hay un turno de **89.9
 * horas** —empezó el 9 de noviembre y lo cerró `iniciar_turno` cuatro días después, al volver
 * esa persona a la pantalla—, y le sumaba 24 horas a cada día de por medio. Nadie cierra el
 * turno al irse. Pasado el tope, lo que hay no es turno: es un turno sin cerrar, y no se
 * cuenta.
 */
alter table site add column if not exists max_shift_hours smallint not null default 12;

alter table site drop constraint if exists site_max_shift_hours_ck;
alter table site add constraint site_max_shift_hours_ck check (max_shift_hours between 1 and 24);

comment on column site.max_shift_hours is
  'Lo más que cuenta un turno que nadie cerró. De ahí en adelante no se cuentan horas.';

/** El reloj de la bodega. Hay un solo sitio, y si algún día hay más, cada uno lleva el suyo. */
create or replace function reloj_de_bodega() returns text
language sql stable set search_path = public as $f$
  select coalesce(min(time_zone), 'UTC') from site;
$f$;

grant execute on function reloj_de_bodega to authenticated;

/** Cuántos días atrás se guardan los números. Dos meses alcanzan para ver la tendencia. */
create or replace function kpi_dias_atras() returns integer
language sql immutable set search_path = public as $f$ select 60; $f$;

grant execute on function kpi_dias_atras to authenticated;

/** Lo más que se le cuenta a un turno que quedó abierto. */
create or replace function tope_de_turno() returns interval
language sql stable set search_path = public as $f$
  select (coalesce(min(max_shift_hours), 12) || ' hours')::interval from site;
$f$;

grant execute on function tope_de_turno to authenticated;

/**
 * Una tarea terminada, con su día, sus cajas y el tiempo que le costó a la persona.
 *
 * Las cajas salen del empaque de la tarea; si no lo trae, del corrugado del producto. Y el
 * tiempo se cuenta desde que la tarea cayó en sus manos, porque el viaje también es trabajo.
 */
create or replace view kpi_tarea as
select
  t.id,
  ((t.completed_at at time zone reloj_de_bodega())::date) as dia,
  t.type,
  t.assigned_to,
  t.qty_base / coalesce(nullif(pl.qty_base_units, 0), nullif(cs.qty_base_units, 0), 1) as cajas,
  coalesce(extract(epoch from (t.completed_at - t.assigned_at)) / 60, 0) as minutos
from task t
left join packaging_level pl on pl.id = t.packaging_level_id
left join packaging_level cs on cs.product_id = t.product_id and cs.code = 'CASE'
where t.status = 'DONE'
  and t.completed_at is not null
  and t.assigned_to is not null
  and t.qty_base is not null
  and t.completed_at >= now() - (kpi_dias_atras() || ' days')::interval;

grant select on kpi_tarea to authenticated;

/** Las horas de turno de cada persona en cada día, partidas por la medianoche de la bodega. */
create or replace view kpi_turno_dia as
with dias as (
  select generate_series(
    current_date - (kpi_dias_atras() || ' days')::interval, current_date, interval '1 day'
  )::date as dia
),
reloj as (select reloj_de_bodega() as zona),
turno as (
  select
    sa.profile_id,
    sa.started_at,
    least(coalesce(sa.ended_at, now()), sa.started_at + tope_de_turno()) as ended_at
  from shift_assignment sa
)
select
  d.dia,
  t.profile_id,
  sum(extract(epoch from (
      least(t.ended_at, ((d.dia + 1)::timestamp at time zone r.zona))
    - greatest(t.started_at, (d.dia::timestamp at time zone r.zona))
  )) / 3600) as horas
from dias d
cross join reloj r
join turno t
  on t.started_at < ((d.dia + 1)::timestamp at time zone r.zona)
 and t.ended_at > (d.dia::timestamp at time zone r.zona)
group by d.dia, t.profile_id;

grant select on kpi_turno_dia to authenticated;

/** Los despachos del día y cuántos salieron completos: la precisión que piden los gerentes. */
create or replace view kpi_despacho_dia as
select
  ((so.shipped_at at time zone reloj_de_bodega())::date) as dia,
  count(*) as camiones,
  -- `ship_note` sólo se llena al cerrar un camión corto, y exige razón. Vacío es completo.
  count(*) filter (where so.ship_note is null) as completos,
  sum((select count(*) from order_line l where l.order_id = so.id)) as lineas,
  sum((select count(*) from order_line l
       where l.order_id = so.id and l.checked_at is not null)) as chequeadas
from sales_order so
where so.shipped_at is not null
  and so.shipped_at >= now() - (kpi_dias_atras() || ' days')::interval
group by 1;

grant select on kpi_despacho_dia to authenticated;

/** El día de la bodega en una fila: lo que se ve de un vistazo. */
create or replace view kpi_dia as
with trabajo as (
  select dia, count(*) as tareas, sum(cajas) as cajas, sum(minutos) as minutos,
         count(distinct assigned_to) as personas
  from kpi_tarea group by dia
),
turnos as (
  select dia, sum(horas) as horas, count(*) as en_turno from kpi_turno_dia group by dia
)
select
  coalesce(t.dia, h.dia, e.dia) as dia,
  coalesce(t.tareas, 0) as tareas,
  round(coalesce(t.cajas, 0), 1) as cajas,
  greatest(coalesce(t.personas, 0), coalesce(h.en_turno, 0)) as personas,
  round(coalesce(h.horas, 0), 1) as horas_turno,
  case when coalesce(h.horas, 0) > 0
       then round(coalesce(t.cajas, 0) / h.horas, 1) end as cajas_por_hora,
  case when coalesce(h.horas, 0) > 0
       then greatest(round(100 - coalesce(t.minutos, 0) / 60 / h.horas * 100), 0) end
       as improductivo_pct,
  coalesce(e.camiones, 0) as camiones,
  coalesce(e.completos, 0) as completos,
  case when coalesce(e.camiones, 0) > 0
       then round(e.completos::numeric / e.camiones * 100) end as precision_pct,
  coalesce(e.lineas, 0) as lineas,
  coalesce(e.chequeadas, 0) as chequeadas
from trabajo t
full join turnos h on h.dia = t.dia
full join kpi_despacho_dia e on e.dia = coalesce(t.dia, h.dia)
order by 1 desc;

grant select on kpi_dia to authenticated;

/**
 * El desglose por persona, que no ve cualquiera: con nombre, cajas, tareas, horas de turno y
 * cuánto de esas horas no estuvo en una tarea.
 */
create or replace function kpi_por_persona(
  p_desde date default null,
  p_hasta date default null
)
returns table (
  profile_id uuid,
  nombre text,
  rol user_role,
  tareas bigint,
  cajas numeric,
  horas_turno numeric,
  horas_trabajando numeric,
  improductivo_pct numeric,
  cajas_por_hora numeric
)
language plpgsql security definer set search_path = public as $f$
declare
  v_hasta date;
  v_desde date;
begin
  if not has_role('supervisor', 'admin', 'solo_lectura') then
    raise exception 'Los números de cada persona los ve el jefe de bodega';
  end if;

  -- Sin fechas, la última semana contada con el reloj de la bodega: así la pantalla no tiene
  -- que saber en qué país está.
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
  )
  select
    p.id,
    p.full_name,
    p.role,
    coalesce(t.tareas, 0),
    round(coalesce(t.cajas, 0), 1),
    round(coalesce(h.horas, 0), 1),
    round(coalesce(t.horas, 0), 1),
    case when coalesce(h.horas, 0) > 0
         then greatest(round(100 - coalesce(t.horas, 0) / h.horas * 100), 0) end,
    case when coalesce(h.horas, 0) > 0
         then round(coalesce(t.cajas, 0) / h.horas, 1) end
  from profile p
  left join trabajo t on t.id = p.id
  left join turnos h on h.id = p.id
  where t.id is not null or h.id is not null
  order by coalesce(t.cajas, 0) desc, p.full_name;
end;
$f$;

grant execute on function kpi_por_persona to authenticated;
