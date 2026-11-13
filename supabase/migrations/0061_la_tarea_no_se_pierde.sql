/**
 * Una tarea empezada no deja a nadie encerrado.
 *
 * Si a alguien se le recarga la pantalla con la posición ya escaneada —el teléfono se durmió,
 * se fue la señal, cerró la app—, la tarea quedaba `IN_PROGRESS` y no volvía nunca:
 *
 *   - `claim_next_task` sólo miraba las `READY`, así que le entregaba otra distinta y la
 *     empezada se quedaba sin dueño con la existencia apartada.
 *   - `soltar_tareas_del_turno` le impedía volver a entrar a trabajo mientras existiera.
 *   - Y para terminarla hacía falta entrar a trabajo. Encerrada.
 *
 * Se arregla por donde tenía que estar desde el principio: lo que la persona ya trae es lo
 * primero que se le da. Con eso, el candado de `soltar_tareas_del_turno` sobra —lo empezado
 * ya no se queda sin dueño, se devuelve—, y volver a escanear la posición deja de ser un
 * error: es justamente lo que hace quien retoma.
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
  v_staging uuid;
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
  if not es_rol_de_trabajo(rol_de_trabajo(auth.uid())) then
    raise exception 'Con tu rango no te caen tareas solas: cámbiate a auxiliar, chequeador o montacarguista y el sistema te empieza a dar trabajo';
  end if;

  -- Lo que ya trae en la mano, antes que nada: primero lo empezado, luego lo asignado.
  select * into v_task
  from task t
  where t.assigned_to = auth.uid()
    and t.status in ('IN_PROGRESS', 'ASSIGNED')
    and (p_types is null or t.type = any(p_types))
    and (p_zone_ids is null or t.zone_id = any(p_zone_ids))
  order by (t.status = 'IN_PROGRESS') desc, t.assigned_at
  limit 1;

  if found then
    return v_task;
  end if;

  v_alcance := alcance_de(auth.uid());
  v_flujo := flujo_de(auth.uid());

  if v_turno.dock_door_id is not null then
    select l.id into v_staging
    from location l
    join dock_door d on d.id = v_turno.dock_door_id
    where l.code = 'STG-' || d.code;
  end if;

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
      and (
        v_staging is null
        or c.type not in ('PUTAWAY', 'PICK')
        or v_staging in (c.from_location_id, c.to_location_id)
      )
    order by c.priority desc, c.created_at
    limit 1
    for update skip locked
  )
  returning t.* into v_task;

  return v_task;
end;
$$;

/**
 * Entrar a trabajo ya no se frena por lo empezado: ahora vuelve solo.
 *
 * Lo asignado y sin empezar sí se suelta, como siempre, para que no se quede acaparado por
 * quien se fue.
 */
create or replace function soltar_tareas_del_turno() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  update task set status = 'READY', assigned_to = null, assigned_at = null
  where assigned_to = auth.uid() and status = 'ASSIGNED';

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

/** Volver a escanear la posición de lo que ya se empezó no es un error. */
create or replace function start_pick(p_task_id uuid, p_location_code text) returns task
language plpgsql security definer set search_path = public as $$
declare
  v_task task;
  v_esperada text;
begin
  select * into v_task from task where id = p_task_id;
  if not found then
    raise exception 'La tarea no existe';
  end if;
  if v_task.assigned_to is distinct from auth.uid() then
    raise exception 'Esa tarea no es tuya';
  end if;
  if v_task.status not in ('ASSIGNED', 'IN_PROGRESS') then
    raise exception 'Esa tarea ya está cerrada';
  end if;

  select code into v_esperada from location where id = v_task.from_location_id;
  if v_esperada is distinct from trim(p_location_code) then
    raise exception 'Esa no es la posición de esta tarea. La correcta es la %', v_esperada;
  end if;

  update task set status = 'IN_PROGRESS', started_at = coalesce(started_at, now())
  where id = p_task_id
  returning * into v_task;

  return v_task;
end;
$$;

/** Lo mismo al guardar: retomar el pallet escaneando otra vez su matrícula. */
create or replace function start_putaway(p_task_id uuid, p_lpn_code text) returns task
language plpgsql security definer set search_path = public as $$
declare
  v_task task;
  v_esperado text;
begin
  select * into v_task from task where id = p_task_id;

  if not found then
    raise exception 'La tarea no existe';
  end if;

  select code into v_esperado from lpn where id = v_task.lpn_id;

  if v_task.assigned_to is distinct from auth.uid() then
    raise exception 'Esa tarea no es tuya';
  end if;
  if v_task.status not in ('ASSIGNED', 'IN_PROGRESS') then
    raise exception 'Esa tarea ya está cerrada';
  end if;
  if v_esperado is distinct from trim(p_lpn_code) then
    raise exception 'Ese no es el pallet de esta tarea. Buscas el %', v_esperado;
  end if;

  update task set status = 'IN_PROGRESS', started_at = coalesce(started_at, now())
  where id = p_task_id
  returning * into v_task;

  return v_task;
end;
$$;
