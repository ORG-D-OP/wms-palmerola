/**
 * «Dos tareas, y 100 % improductivo».
 *
 * Así salía en Indicadores: una persona con dos tareas hechas y, en el mismo renglón, un
 * sistema diciendo que no hizo nada en todo el turno. La cuenta no estaba mal —dos tareas de
 * minuto y medio en ocho horas y media de turno son un 99.6 % fuera de tarea— pero el
 * redondeo la convertía en una contradicción: 99.6 sube a 100, y 100 % improductivo quiere
 * decir «ni un minuto en tarea», que es justo lo contrario de lo que el renglón de al lado
 * enseña.
 *
 * Así que se trunca en vez de redondear. Por debajo del entero el número no significa nada
 * —nadie decide con la décima de un porcentaje de turno— y por arriba truncar deja el 100 %
 * reservado para el único caso en que es verdad: cero minutos de tarea. Lo mismo en el
 * resumen del día y en el desglose por persona, que es la misma cuenta dos veces.
 *
 * Lo que esto no arregla, y hay que decirlo: las horas de turno de un turno que cerró el
 * sistema son un cálculo, y el improductivo se mide contra ellas. La pantalla ya lo avisa
 * persona por persona; el día entero todavía no.
 */

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
       then greatest(floor(100 - coalesce(t.minutos, 0) / 60 / h.horas * 100), 0) end
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
         then greatest(floor(100 - coalesce(t.horas, 0) / h.horas * 100), 0) end,
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
