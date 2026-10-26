create type task_type as enum ('PUTAWAY', 'PICK', 'REPLENISH', 'MOVE', 'COUNT', 'RELOCATE');
create type task_status as enum ('READY', 'ASSIGNED', 'IN_PROGRESS', 'DONE', 'CANCELLED', 'BLOCKED');

create table wave (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  dock_door_id uuid references dock_door on delete restrict,
  cutoff_at timestamptz,
  created_at timestamptz not null default now()
);

-- Las marcas de tiempo son el origen de todos los KPI de productividad: no hay
-- telemetria aparte. Cada paso del ciclo deja la suya.
create table task (
  id uuid primary key default gen_random_uuid(),
  type task_type not null,
  status task_status not null default 'READY',
  priority smallint not null default 100 check (priority between 1 and 999),

  product_id uuid references product on delete restrict,
  qty_base numeric(14, 3) check (qty_base > 0),
  packaging_level_id uuid references packaging_level on delete restrict,
  lpn_id uuid references lpn on delete restrict,
  lot text,
  expiry_date date,

  from_location_id uuid references location on delete restrict,
  to_location_id uuid references location on delete restrict,
  zone_id uuid references zone on delete restrict,
  wave_id uuid references wave on delete set null,

  assigned_to uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  assigned_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  closed_reason text,

  constraint tiempos_en_orden check (
    (assigned_at is null or assigned_at >= created_at)
    and (started_at is null or started_at >= assigned_at)
    and (completed_at is null or completed_at >= started_at)
  ),
  constraint asignada_tiene_responsable check (
    status not in ('ASSIGNED', 'IN_PROGRESS') or assigned_to is not null
  )
);

create index task_cola on task (status, priority desc, created_at) where status = 'READY';
create index task_de_persona on task (assigned_to, status) where status in ('ASSIGNED', 'IN_PROGRESS');
create index task_por_zona on task (zone_id, status);

create trigger task_audit after insert or update or delete on task
for each row execute function audit_changes();

-- Reserva de hueco: una posicion no puede quedar apartada por dos tareas a la vez,
-- porque la columna solo admite un valor. La reserva caduca sola.
alter table location
  add column reserved_by_task_id uuid references task on delete set null,
  add column reserved_until timestamptz;

create index location_reservada on location (reserved_by_task_id)
  where reserved_by_task_id is not null;

-- Reserva de existencia: lo apartado por una ola no lo puede tomar otra.
alter table stock
  add column qty_allocated numeric(14, 3) not null default 0 check (qty_allocated >= 0),
  add constraint reservado_no_supera_existencia check (qty_allocated <= qty_base);

create view stock_available as
select
  s.*,
  s.qty_base - s.qty_allocated as qty_available
from stock s;

/**
 * Entrega la siguiente tarea al operario que la pide. SKIP LOCKED hace que dos
 * personas pidiendo trabajo en el mismo instante nunca reciban la misma tarea,
 * sin bloqueos ni reintentos.
 */
create function claim_next_task(
  p_types task_type[] default null,
  p_zone_ids uuid[] default null
) returns task
language plpgsql security definer set search_path = public as $$
declare
  v_task task;
begin
  if auth.uid() is null then
    raise exception 'Hace falta una sesion para tomar trabajo';
  end if;

  update task t
  set status = 'ASSIGNED', assigned_to = auth.uid(), assigned_at = now()
  where t.id = (
    select c.id
    from task c
    where c.status = 'READY'
      and (p_types is null or c.type = any(p_types))
      and (p_zone_ids is null or c.zone_id = any(p_zone_ids))
    order by c.priority desc, c.created_at
    limit 1
    for update skip locked
  )
  returning t.* into v_task;

  return v_task;
end;
$$;

create function start_task(p_task_id uuid) returns task
language plpgsql security definer set search_path = public as $$
declare
  v_task task;
begin
  update task
  set status = 'IN_PROGRESS', started_at = now()
  where id = p_task_id and assigned_to = auth.uid() and status = 'ASSIGNED'
  returning * into v_task;

  if not found then
    raise exception 'La tarea no esta asignada a ti o ya empezo';
  end if;

  return v_task;
end;
$$;

create function close_task(p_task_id uuid, p_status task_status, p_reason text default null)
returns task
language plpgsql security definer set search_path = public as $$
declare
  v_task task;
begin
  if p_status not in ('DONE', 'CANCELLED', 'BLOCKED') then
    raise exception 'Una tarea solo se cierra como DONE, CANCELLED o BLOCKED';
  end if;

  update task
  set status = p_status,
      completed_at = now(),
      closed_reason = p_reason
  where id = p_task_id
    and status in ('ASSIGNED', 'IN_PROGRESS')
    and (assigned_to = auth.uid() or has_role('supervisor', 'admin'))
  returning * into v_task;

  if not found then
    raise exception 'La tarea no existe, no es tuya o ya estaba cerrada';
  end if;

  -- El hueco apartado se libera al cerrar, pase lo que pase con la tarea.
  update location set reserved_by_task_id = null, reserved_until = null
  where reserved_by_task_id = p_task_id;

  return v_task;
end;
$$;

/** Minutos por etapa, que es de donde salen los indicadores de productividad. */
create view task_timing as
select
  t.id,
  t.type,
  t.status,
  t.assigned_to,
  t.zone_id,
  t.created_at,
  t.completed_at,
  extract(epoch from (t.assigned_at - t.created_at)) / 60 as espera_min,
  extract(epoch from (t.started_at - t.assigned_at)) / 60 as viaje_min,
  extract(epoch from (t.completed_at - t.started_at)) / 60 as ejecucion_min,
  extract(epoch from (t.completed_at - t.created_at)) / 60 as ciclo_min
from task t;

alter table wave enable row level security;
alter table task enable row level security;

create policy wave_read on wave for select to authenticated using (true);
create policy wave_write on wave for all to authenticated
  using (has_role('supervisor', 'admin')) with check (has_role('supervisor', 'admin'));

create policy task_read on task for select to authenticated using (true);
create policy task_write_supervisor on task for all to authenticated
  using (has_role('supervisor', 'admin')) with check (has_role('supervisor', 'admin'));

grant select on task, wave, task_timing, stock_available to authenticated;
grant insert, update, delete on wave to authenticated;
grant insert, update, delete on task to authenticated;
grant execute on function claim_next_task, start_task, close_task to authenticated;
