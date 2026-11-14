/**
 * El encierro del jefe con una tarea empezada.
 *
 * Medido en producción el 14/11, con su propia cuenta de administrador y sin poder salir:
 *
 *   1. Empezó un guardado trabajando de montacarguista.
 *   2. Se salió de trabajo y volvió a entrar. Al volver, `iniciar_turno` no escribe rol, así
 *      que el rol del turno vuelve a ser su **rango**: administrador.
 *   3. Guardar le contestó **«Con tu rango no te caen tareas solas»**, porque ese portón
 *      estaba **antes** de entregarle lo que ya traía en la mano.
 *   4. Y cambiarse a montacarguista le contestó **«Termina primero lo que tienes empezado»**,
 *      que es correcto y a propósito.
 *
 * Las dos respuestas, cada una por su lado, están bien. Juntas no dejan salida: no puede
 * terminar la tarea porque su rango no recibe tareas, y no puede cambiar de rango porque tiene
 * una tarea sin terminar. Sin tocar la base no hay cómo seguir, y eso en una bodega significa
 * un pallet detenido en el andén y una persona esperando.
 *
 * El arreglo es mover un bloque: **lo que la persona ya trae en la mano se le entrega siempre**,
 * antes de preguntar de qué trabaja hoy. El portón del rango sigue entero para lo que sí
 * decide: que no le **caigan** tareas nuevas. La 0083 ya puso ese bloque antes del filtro por
 * tipo de tarea, con el mismo razonamiento —«si se cambió de rol a media tarea, la termina»—;
 * esto lo pone también antes del portón del rango, que es el que faltaba.
 *
 * Que esto sólo le pase al supervisor y al administrador no lo hace raro: es justo quien va a
 * estar bajando a ayudar, y el rango de los demás ya es un rol de trabajo.
 */
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

  -- Lo que ya trae en la mano, antes que nada y antes que nadie: primero lo empezado, luego lo
  -- asignado. Va antes del portón del rango y antes del filtro por rol a propósito. Quien
  -- anda con un pallet a medio camino lo termina, trabaje hoy de lo que trabaje.
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

  v_rol := rol_de_trabajo(auth.uid());

  if not es_rol_de_trabajo(v_rol) then
    raise exception 'Con tu rango no te caen tareas solas: cámbiate a auxiliar, chequeador o montacarguista y el sistema te empieza a dar trabajo';
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
