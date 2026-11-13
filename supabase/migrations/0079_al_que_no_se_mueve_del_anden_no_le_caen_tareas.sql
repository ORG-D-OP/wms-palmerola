/**
 * El chequeador no se mueve del andén, y el sistema le estaba dando viajes.
 *
 * Lo que hace un chequeador: ve bajar el producto, lo revisa, dice si está bueno y a dónde va.
 * Luego **la tarea pasa a otro**. En el despacho igual: lee el tabulado, el surtido les cae a
 * los auxiliares y montacarguistas, y él espera en el andén a que llegue para escanearlo y
 * decir si entra al camión. No camina a una posición de racks ni en el ingreso ni en el
 * despacho.
 *
 * Medido en la base real: hay **4 PUTAWAY y 10 PICK** en manos de gente cuyo turno abierto dice
 * `chequeador`. No es casualidad ni un caso raro: `claim_next_task` exige que el rol de trabajo
 * sea de piso (`es_rol_de_trabajo`) y después reparte **sin volver a mirarlo**, así que al
 * chequeador le cae lo mismo que al auxiliar. De las 16 funciones que escriben `assigned_to`,
 * **ninguna** mira `working_role`.
 *
 * El filtro va aquí y no en los permisos. El permiso se cuelga del rango y de lo concedido, que
 * es lo que cubre las vacaciones y el «bajá a ayudar»: un chequeador de rango que hoy entra a
 * trabajar de auxiliar tiene que poder guardar pallets. Lo que decide si te caen viajes es el
 * **rol del turno**, igual que en la 0055, no tu puesto.
 *
 * Lo que ya trae en la mano **no** se le quita: si se cambió de rol a media tarea, la tarea se
 * termina. Quitársela lo dejaría encerrado, que es justo el fallo que arreglamos antes.
 *
 * El conteo sí le sigue cayendo: eso estaba decidido —la tarea de conteo cíclico le cae a
 * cualquiera— y es lo único que puede hacer entre camión y camión.
 */
create or replace function tareas_de(p_rol user_role) returns task_type[]
language sql immutable set search_path = public as $f$
  select case p_rol
    -- El chequeador trabaja en el andén: recibe, chequea y carga. Nada que sea caminar.
    when 'chequeador' then array['COUNT']::task_type[]
    else enum_range(null::task_type)::task_type[]
  end;
$f$;

comment on function tareas_de is
  'Qué tipos de tarea le caen solas a quien trabaja de este rol en su turno.';

grant execute on function tareas_de to authenticated;

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

  -- Si lo que pide la pantalla no es de su rol, se lo dice. Devolver «no hay nada» sería
  -- mentirle: hay de sobra, pero no es suyo.
  if p_types is not null and not (p_types && v_suyas) then
    if v_rol = 'chequeador' then
      raise exception 'De chequeador no te toca ir a dejar ni a traer producto: tú lo recibes y lo despachas en el andén, y el viaje les cae a los auxiliares y montacarguistas';
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
