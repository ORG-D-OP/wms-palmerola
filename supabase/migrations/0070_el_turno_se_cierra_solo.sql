/**
 * El turno se cierra solo, porque nadie lo cierra al irse.
 *
 * Medido contra la base real: hay un turno de **89.9 horas** —empezó el 9 de noviembre y lo
 * cerró `iniciar_turno` cuatro días después, cuando esa persona volvió a la pantalla—, y le
 * sumaba 24 horas a cada día de por medio. La migración 0068 le puso un tope al contar
 * (`site.max_shift_hours`), pero eso sólo tapaba el número: el turno seguía abierto, y con él
 * **las tareas asignadas y sin empezar seguían siendo de alguien que ya se fue**, así que
 * nadie más podía tomarlas.
 *
 * Tres decisiones:
 *
 *   1. **Cuándo se mira.** Pasado el tope de horas desde que entró, y sólo si lleva un rato
 *      en silencio (`site.close_after_idle_minutes`, una hora). Ese silencio es lo que evita
 *      cortarle el turno a quien sigue trabajando de más.
 *   2. **A qué hora se cierra.** A la **última señal de vida** que el sistema tenga de esa
 *      persona: la última tarea que terminó, o cuando se marcó no disponible. Si no hay
 *      ninguna —el jefe que entró y no tomó tareas—, al tope de horas, que es la única cota
 *      que queda. Y el turno queda marcado (`auto_closed`), porque esa hora es un cálculo y
 *      no un dato: quien mire los indicadores tiene que saberlo.
 *   3. **Lo que tenía asignado vuelve a la cola.** Lo no empezado, que ya no es trabajo suyo.
 *      Lo que anda con las manos en la masa se queda a su nombre: un pallet a medio camino
 *      necesita que alguien lo resuelva, no que cambie de dueño.
 */
alter table site add column if not exists close_after_idle_minutes smallint not null default 60;

alter table site drop constraint if exists site_close_after_idle_ck;
alter table site add constraint site_close_after_idle_ck
  check (close_after_idle_minutes between 5 and 480);

comment on column site.close_after_idle_minutes is
  'Cuánto silencio hace falta, pasado el tope de horas, para que el sistema cierre el turno.';

alter table shift_assignment add column if not exists auto_closed boolean not null default false;

comment on column shift_assignment.auto_closed is
  'Lo cerró el sistema, no la persona: la hora de salida es un cálculo, no un dato.';

/** El silencio que hace falta para dar por ido a alguien. */
create or replace function espera_antes_de_cerrar() returns interval
language sql stable set search_path = public as $f$
  select (coalesce(min(close_after_idle_minutes), 60) || ' minutes')::interval from site;
$f$;

grant execute on function espera_antes_de_cerrar to authenticated;

/**
 * Suelta lo asignado y sin empezar de una persona. Hasta ahora sólo existía para uno mismo
 * (`auth.uid()`), y el cierre automático tiene que poder hacerlo por quien ya no está.
 */
create or replace function soltar_lo_de(p_profile_id uuid) returns integer
language plpgsql security definer set search_path = public as $f$
declare
  v_n integer;
begin
  update task set status = 'READY', assigned_to = null, assigned_at = null
  where assigned_to = p_profile_id and status = 'ASSIGNED';

  get diagnostics v_n = row_count;
  return v_n;
end;
$f$;

create or replace function soltar_lo_no_empezado() returns integer
language sql security definer set search_path = public as $f$
  select soltar_lo_de(auth.uid());
$f$;

/**
 * Cierra los turnos que quedaron encendidos. Lo corre el reloj de la base cada cinco minutos,
 * y también `iniciar_turno`, para que la cuenta esté bien aunque el reloj falle.
 */
create or replace function cerrar_turnos_vencidos() returns integer
language plpgsql security definer set search_path = public as $f$
declare
  v_n integer := 0;
  v_turno record;
begin
  for v_turno in
    select
      sa.id,
      sa.profile_id,
      sa.started_at,
      -- La última señal de vida: lo último que terminó, o cuando se marcó no disponible.
      greatest(
        sa.paused_at,
        (select max(t.completed_at) from task t
          where t.assigned_to = sa.profile_id and t.completed_at >= sa.started_at)
      ) as ultima
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
 * Y el cierre a mano también suelta lo no empezado. Faltaba desde la 0025: quien cerraba el
 * turno se iba a casa con sus tareas asignadas a su nombre, y `claim_next_task` sólo reparte
 * las libres, así que esos pallets no los podía tomar nadie hasta que esa persona volviera.
 */
create or replace function cerrar_turno() returns integer
language plpgsql security definer set search_path = public as $f$
declare
  v_n integer;
begin
  update shift_assignment set ended_at = clock_timestamp()
  where profile_id = auth.uid() and ended_at is null;
  get diagnostics v_n = row_count;

  if v_n > 0 then
    perform soltar_lo_no_empezado();
  end if;

  return v_n;
end;
$f$;

grant execute on function cerrar_turno to authenticated;

/**
 * El desglose por persona dice cuántos de sus turnos los cerró el sistema, porque esas horas
 * son un cálculo: sin eso, un número bajo no se distingue de un turno que nadie cerró.
 */
drop function if exists kpi_por_persona(date, date);

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
  cajas_por_hora numeric,
  turnos_calculados bigint
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
         then round(coalesce(t.cajas, 0) / h.horas, 1) end,
    coalesce(c.turnos, 0)
  from profile p
  left join trabajo t on t.id = p.id
  left join turnos h on h.id = p.id
  left join calculados c on c.id = p.id
  where t.id is not null or h.id is not null
  order by coalesce(t.cajas, 0) desc, p.full_name;
end;
$f$;

grant execute on function kpi_por_persona to authenticated;

/**
 * El reloj de la base. Cada cinco minutos, que es lo más tarde que se puede enterar de que
 * alguien se fue. Va entre guardas porque el Postgres de las comprobaciones no trae `pg_cron`
 * y ahí el cierre lo dispara `iniciar_turno`.
 */
do $cron$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    perform cron.unschedule('cerrar-turnos-vencidos')
      where exists (select 1 from cron.job where jobname = 'cerrar-turnos-vencidos');
    perform cron.schedule(
      'cerrar-turnos-vencidos', '*/5 * * * *', 'select cerrar_turnos_vencidos()'
    );
  end if;
end
$cron$;

/**
 * Y entrar a trabajo cierra de paso los turnos vencidos. Esto es lo que dejó el turno de 89.9
 * horas: `iniciar_turno` cerraba el turno viejo **a la hora en que la persona volvía**, que
 * cuatro días después no es la hora en que se fue. Ahora los vencidos ya están cerrados
 * cuando llega a esa línea, así que lo que cierre aquí es un turno de verdad del día.
 */
create or replace function iniciar_turno(
  p_tipo_equipo text default null,
  p_flow text default 'BOTH',
  p_rol user_role default null
)
returns shift_assignment
language plpgsql security definer set search_path = public as $f$
declare
  v_tipo equipment_type;
  v_anden uuid;
  v_turno shift_assignment;
  v_rol user_role := p_rol;
begin
  if auth.uid() is null then
    raise exception 'Hace falta una sesión para iniciar turno';
  end if;
  if p_flow not in ('INBOUND', 'OUTBOUND', 'BOTH') then
    raise exception 'El flujo tiene que ser ingreso, despacho o los dos';
  end if;

  if v_rol is not null and not puede_trabajar_como(v_rol) then
    raise exception 'No puedes trabajar como %: pídele al jefe que te lo conceda', v_rol;
  end if;

  if p_tipo_equipo is not null then
    select * into v_tipo from equipment_type
    where code = upper(trim(p_tipo_equipo)) and is_active;
    if not found then
      raise exception 'El tipo de equipo % no existe', p_tipo_equipo;
    end if;
  end if;

  select dock_door_id into v_anden
  from shift_assignment
  where profile_id = auth.uid() and ended_at is null
  order by started_at desc
  limit 1;

  -- Lo empezado no se suelta ni frena la entrada: vuelve solo a la pantalla (0061).
  perform soltar_lo_no_empezado();

  -- Y de paso se cierran los turnos que quedaron encendidos, por si el reloj de la base
  -- falló: el de esta persona se cierra abajo, pero el de quien no ha vuelto, no.
  perform cerrar_turnos_vencidos();

  update shift_assignment set ended_at = clock_timestamp()
  where profile_id = auth.uid() and ended_at is null;

  insert into shift_assignment (profile_id, equipment_type_code, flow, working_role, dock_door_id)
  values (auth.uid(), v_tipo.code, p_flow, v_rol, v_anden)
  returning * into v_turno;

  return v_turno;
end;
$f$;

grant execute on function iniciar_turno to authenticated;
