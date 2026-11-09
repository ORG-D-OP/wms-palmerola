/**
 * No hay turnos: hay gente disponible y gente que no.
 *
 * El modelo de turnos nació de suponer que la bodega trabaja con hora de entrada y de
 * salida declaradas. No es así. Lo único que el sistema necesita saber es, en este momento,
 * **quién está disponible para recibir tarea**: lo primero que ve una persona al entrar es
 * un botón de entrar a trabajo, y dentro del menú está la contraparte, para cuando le
 * hablan para otra cosa.
 *
 * La tabla no cambia de nombre —`shift_assignment` ya guardaba lo correcto: una fila abierta
 * por persona, con su equipo— pero gana una pausa, que es lo que faltaba. Cerrar y volver a
 * abrir no servía: perdía el equipo asignado y ensuciaba la medición de la jornada.
 */

alter table shift_assignment
  add column if not exists paused_at timestamptz,
  add column if not exists pause_note text check (pause_note is null or length(pause_note) <= 200);

comment on column shift_assignment.paused_at is
  'Nulo = disponible. Con fecha, la persona está en la bodega pero no recibe tareas.';

create or replace function pausar_turno(p_motivo text default null) returns shift_assignment
language plpgsql security definer set search_path = public as $$
declare
  v_turno shift_assignment;
begin
  if auth.uid() is null then
    raise exception 'Hace falta una sesión';
  end if;

  update shift_assignment
  set paused_at = now(), pause_note = nullif(trim(coalesce(p_motivo, '')), '')
  where profile_id = auth.uid() and ended_at is null and paused_at is null
  returning * into v_turno;

  if not found then
    raise exception 'No estás trabajando, o ya estabas marcado como no disponible';
  end if;

  return v_turno;
end;
$$;

create or replace function reanudar_turno() returns shift_assignment
language plpgsql security definer set search_path = public as $$
declare
  v_turno shift_assignment;
begin
  update shift_assignment
  set paused_at = null, pause_note = null
  where profile_id = auth.uid() and ended_at is null and paused_at is not null
  returning * into v_turno;

  if not found then
    raise exception 'No tienes nada que reanudar';
  end if;

  return v_turno;
end;
$$;

grant execute on function pausar_turno, reanudar_turno to authenticated;

/**
 * La cola sólo reparte a quien está disponible.
 *
 * Antes no hacía falta estar en nada: cualquiera podía tomar tarea, y el turno sólo servía
 * para saber con qué equipo. El resultado era que el sistema no tenía forma de saber quién
 * estaba en la bodega. Ahora entrar a trabajo es lo que te pone en la cola, y eso es
 * precisamente para qué sirve el botón.
 */
create or replace function claim_next_task(
  p_types task_type[] default null,
  p_zone_ids uuid[] default null
) returns task
language plpgsql security definer set search_path = public as $$
declare
  v_task task;
  v_turno shift_assignment;
  v_alcance smallint;
  v_flujo text;
begin
  if auth.uid() is null then
    raise exception 'Hace falta una sesión para tomar trabajo';
  end if;

  select * into v_turno
  from shift_assignment
  where profile_id = auth.uid() and ended_at is null;

  if not found then
    raise exception 'Entra a trabajo para que te toquen tareas';
  end if;
  if v_turno.paused_at is not null then
    raise exception 'Estás marcado como no disponible';
  end if;

  v_alcance := alcance_de(auth.uid());
  v_flujo := flujo_de(auth.uid());

  update task t
  set status = 'ASSIGNED', assigned_to = auth.uid(), assigned_at = now()
  where t.id = (
    select c.id
    from task c
    where c.status = 'READY'
      and (p_types is null or c.type = any(p_types))
      and (p_zone_ids is null or c.zone_id = any(p_zone_ids))
      and coalesce(c.min_level, 0) <= v_alcance
      and (v_flujo = 'BOTH' or c.flow is null or c.flow = v_flujo)
    order by c.priority desc, c.created_at
    limit 1
    for update skip locked
  )
  returning t.* into v_task;

  return v_task;
end;
$$;

grant execute on function claim_next_task to authenticated;

/** Mi estado ahora: si estoy trabajando, con qué equipo, y si estoy disponible. */
create or replace view mi_trabajo as
  select
    sa.profile_id,
    sa.started_at,
    sa.paused_at,
    sa.pause_note,
    sa.flow,
    e.code as equipo,
    t.name as tipo_equipo,
    t.max_level as alcance
  from shift_assignment sa
  left join equipment e on e.id = sa.equipment_id
  left join equipment_type t on t.code = e.type_code
  where sa.ended_at is null;

grant select on mi_trabajo to authenticated;

/** Quién está en la bodega ahora mismo. Es lo que el jefe necesita para repartir gente. */
create or replace view disponibles as
  select
    p.id,
    p.full_name,
    p.role,
    sa.started_at,
    sa.paused_at is null as disponible,
    sa.pause_note,
    e.code as equipo
  from shift_assignment sa
  join profile p on p.id = sa.profile_id
  left join equipment e on e.id = sa.equipment_id
  where sa.ended_at is null;

grant select on disponibles to authenticated;
