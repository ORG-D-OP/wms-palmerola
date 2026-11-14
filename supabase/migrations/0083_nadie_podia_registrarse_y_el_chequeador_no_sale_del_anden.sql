/**
 * Nadie podía crear una cuenta. Ninguno. Desde que existe la lista de correos.
 *
 * El registro ocurre **sin sesión**, así que lee la lista de correos dados de alta con la
 * llave secreta, y esa llave entra a la base como `service_role`. Sobre `correo_autorizado`
 * ese rol tenía `REFERENCES, TRIGGER, TRUNCATE` y **ni un SELECT**: la 0050 creó la tabla,
 * encendió RLS y dio permiso sólo a las tres funciones. A la tabla, a nadie.
 *
 * Así que la consulta del registro no devolvía nada **nunca**, para ningún correo, y la
 * pantalla contestaba «Ese correo no está dado de alta» a todo el mundo. Da igual lo que el
 * jefe diera de alta. La base lo dice ella misma:
 *
 *     403  permission denied for table correo_autorizado
 *     hint: GRANT SELECT ON public.correo_autorizado TO service_role;
 *
 * Es un olvido y no un criterio: en este proyecto el permiso de `service_role` se da a mano,
 * tabla por tabla, y ya lo hacen la 0008 (`profile`), la 0013 y la 0023. A ésta se le olvidó.
 */
grant select on public.correo_autorizado to service_role;

/**
 * Y el chequeador no sale del andén, tampoco a contar.
 *
 * Lo dijo otra vez, y más claro: **no hay chequeadores de picking**. El chequeador verifica lo
 * que entra y lo que sale, en el andén, y **las tareas de meter o sacar producto son de los
 * auxiliares y de los montacarguistas**. La 0079 le dejó el conteo cíclico, y contar es irse a
 * una posición de racks: eso también es salir del andén.
 *
 * Queda sin ninguna: el que trabaja de chequeador no recibe tareas. Lo que ya trae en la mano
 * se lo sigue dando `claim_next_task`, que mira eso antes del filtro, para no dejar a nadie
 * encerrado a media tarea.
 */
create or replace function tareas_de(p_rol user_role) returns task_type[]
language sql immutable set search_path = public as $f$
  select case p_rol
    -- El chequeador trabaja en el andén. Ni guardar, ni surtir, ni contar: nada de caminar.
    when 'chequeador' then array[]::task_type[]
    else enum_range(null::task_type)::task_type[]
  end;
$f$;

create or replace function claim_next_task(
  p_types task_type[] default null,
  p_zone_ids uuid[] default null
) returns task
language plpgsql security definer set search_path = public as $f$
declare
  v_task task;
  v_turno shift_assignment;
  v_alcance smallint;
  v_flujo text;
  v_staging uuid;
  v_rol user_role;
  v_suyas task_type[];
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

  v_rol := rol_de_trabajo(auth.uid());

  if not es_rol_de_trabajo(v_rol) then
    raise exception 'Con tu rango no te caen tareas solas: cámbiate a auxiliar, chequeador o montacarguista y el sistema te empieza a dar trabajo';
  end if;

  -- Lo que ya trae en la mano, antes que nada: primero lo empezado, luego lo asignado. Esto va
  -- antes del filtro por rol a propósito: si se cambió de rol a media tarea, la termina.
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

  v_suyas := tareas_de(v_rol);

  -- Si no es de su rol, se lo dice. Devolver «no hay nada» sería mentirle: hay de sobra, pero
  -- no es suyo.
  if cardinality(v_suyas) = 0 or (p_types is not null and not (p_types && v_suyas)) then
    if v_rol = 'chequeador' then
      raise exception 'De chequeador tu trabajo es el andén: verificar lo que entra y lo que sale. Meter y sacar producto les toca a los auxiliares y a los montacarguistas';
    end if;
    raise exception 'Trabajando de % no te caen esas tareas', v_rol;
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
      and c.type = any(v_suyas)
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
$f$;
