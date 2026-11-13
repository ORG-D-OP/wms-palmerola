/**
 * Ahora que el turno se cierra solo (0070), el tope deja de aplicarse a los turnos cerrados.
 *
 * La 0068 contaba **todo** turno con tope de 12 horas, porque no había forma de distinguir el
 * que alguien dejó encendido del que duró de verdad. Con el cierre automático sí la hay: un
 * turno cerrado lo cerró la persona o lo calculó el sistema a su última señal de vida, y en
 * los dos casos la hora es lo mejor que se sabe. Dejarle el tope encima sería **recortarle en
 * silencio las horas de más a quien se quedó**, y eso en una bodega se nota.
 *
 * Así que el tope se queda donde todavía hace falta: en el turno **abierto**, que mientras
 * nadie lo cierre no tiene hora de salida que valga.
 */
create or replace function ultima_senal_de(p_shift_id uuid) returns timestamptz
language sql stable security definer set search_path = public as $f$
  -- La última señal de vida **dentro de ese turno**: lo último que esa persona terminó, o
  -- cuando se marcó no disponible. El corte de arriba es el turno siguiente de esa misma
  -- persona, y no es un detalle: sin él, un turno que quedó abierto el lunes se estira hasta
  -- la tarea que ella hizo el viernes, en otro turno.
  select greatest(
    sa.paused_at,
    (select max(t.completed_at) from task t
      where t.assigned_to = sa.profile_id
        and t.completed_at >= sa.started_at
        and t.completed_at < coalesce(
          (select min(s2.started_at) from shift_assignment s2
            where s2.profile_id = sa.profile_id and s2.started_at > sa.started_at),
          'infinity'::timestamptz
        ))
  )
  from shift_assignment sa
  where sa.id = p_shift_id;
$f$;

create or replace function cerrar_turnos_vencidos() returns integer
language plpgsql security definer set search_path = public as $f$
declare
  v_n integer := 0;
  v_turno record;
begin
  for v_turno in
    select sa.id, sa.profile_id, sa.started_at,
           ultima_senal_de(sa.id) as ultima
    from shift_assignment sa
    where sa.ended_at is null
      and sa.started_at + tope_de_turno() <= clock_timestamp()
      -- Con algo en la mano no se le cierra el turno a nadie.
      and not exists (
        select 1 from task t
        where t.assigned_to = sa.profile_id and t.status = 'IN_PROGRESS'
      )
  loop
    if greatest(v_turno.started_at, v_turno.ultima)
       > clock_timestamp() - espera_antes_de_cerrar() then
      continue;
    end if;

    update shift_assignment
       set ended_at = coalesce(v_turno.ultima, v_turno.started_at + tope_de_turno()),
           auto_closed = true
     where id = v_turno.id;

    perform soltar_lo_de(v_turno.profile_id);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$f$;

/**
 * Y los turnos que el error dejó mal cerrados se arreglan, porque si no el tope tiene que
 * seguir puesto para taparlos. En la base real es uno: el de **89.9 horas**, que
 * `iniciar_turno` cerró cuatro días después a la hora en que esa persona volvió.
 *
 * Aquí el tope **sí** hace de techo, y es la diferencia con el cierre automático: un turno de
 * cuatro días no es un turno largo, es un dato roto, y de cuándo se fue esa persona el primer
 * día no hay nada. Lo que queda es la cota. Si la última señal de vida cae antes, mejor: esa
 * se sabe. Y nunca se alarga lo que ya estaba.
 */
update shift_assignment sa
   set ended_at = least(
         sa.ended_at,
         sa.started_at + tope_de_turno(),
         coalesce(ultima_senal_de(sa.id), sa.started_at + tope_de_turno())
       ),
       auto_closed = true
 where sa.ended_at is not null
   and not sa.auto_closed
   and sa.ended_at - sa.started_at > tope_de_turno();

/** El tope se queda sólo en el turno abierto, que no tiene hora de salida que valga. */
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
    coalesce(sa.ended_at, least(now(), sa.started_at + tope_de_turno())) as ended_at
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
