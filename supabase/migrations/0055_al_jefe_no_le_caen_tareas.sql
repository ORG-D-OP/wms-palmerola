/**
 * Al supervisor no le caen tareas solo.
 *
 * `claim_next_task` filtraba por alcance del equipo y por flujo, pero no por rol: quien tuviera
 * un turno abierto entraba a la cola, el jefe incluido. Eso es justo lo que no se quiere —el
 * jefe reparte, no surte— y es la razon por la que existe `trabajar_como` (0053): bajar a
 * ayudar tiene que ser una decision suya, no algo que le pase por tener la sesion abierta.
 *
 * Asi que la cola automatica mira el **rol con el que esta trabajando**, no el rango. El jefe
 * que se declara auxiliar recibe tareas de auxiliar; mientras no lo haga, no recibe ninguna.
 *
 * Lo que el jefe le asigna a alguien a mano no pasa por aqui, asi que sigue pudiendose: si el
 * jefe quiere darse una tarea a si mismo, puede.
 */
create or replace function es_rol_de_trabajo(p_rol user_role) returns boolean
language sql immutable as $$
  select p_rol in ('auxiliar', 'chequeador', 'montacargista');
$$;

grant execute on function es_rol_de_trabajo to authenticated;

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
