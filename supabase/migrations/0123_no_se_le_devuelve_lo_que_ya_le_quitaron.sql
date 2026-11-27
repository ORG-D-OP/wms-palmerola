/**
 * A nadie se le devuelve la tarea que ya le quitaron.
 *
 * La 0121 abrió la salida: el jefe devuelve a la cola una tarea que alguien empezó y no puede
 * terminar. Pero volvía a la cola **de su andén**, y la cola no sabía de dónde venía: si quien
 * la devolvió es el único parado ahí, le caía otra vez de inmediato.
 *
 * Y le caía por una razón que no cambia sola. Quien devuelve una tarea es quien no la pudo
 * hacer —el pallet no estaba donde decía, o no era ése—, así que dársela de nuevo es mandarlo
 * al mismo callejón y obligar al jefe a sacarlo dos veces. El contador de vueltas de la
 * pantalla del jefe dejaba ver el bucle; esto lo corta.
 *
 * **Con una excepción, que es la que evita el callejón nuevo:** si no hay nadie más trabajando,
 * le vuelve a caer. Una tarea que nadie puede tomar es peor que una que vuelve a quien ya la
 * tuvo, y el que está solo en la bodega es el único que puede intentarlo otra vez —puede que
 * entre las dos veces alguien haya puesto el pallet donde va.
 *
 * Lo demás de `claim_next_task` queda igual, declarado desde su versión vigente (0107).
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
  v_minimo smallint;
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
  v_minimo := nivel_minimo_de(auth.uid());
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
      -- Llegar es condición de todos: a nadie se le manda a un nivel que no alcanza.
      and coalesce(c.min_level, 0) <= v_alcance
      -- Y mover un pallet es cosa de la máquina: el de piso sólo piso, el de rack sólo rack.
      -- Contar queda fuera a propósito: no es tarea de máquina, es de los ojos, así que ahí
      -- sigue bastando con llegar.
      and (c.type = 'COUNT' or coalesce(c.min_level, 0) >= v_minimo)
      and (v_flujo = 'BOTH' or c.flow is null or c.flow = v_flujo)
      and (
        v_staging is null
        or c.type not in ('PUTAWAY', 'PICK')
        or v_staging in (c.from_location_id, c.to_location_id)
      )
      -- Y no se le devuelve lo que ya le quitaron. Quien devolvió una tarea es quien no la
      -- pudo hacer —el pallet no estaba, o no era ése—, así que dársela otra vez es mandarlo
      -- al mismo callejón y obligar al jefe a sacarlo dos veces.
      and (
        not exists (
          select 1 from tarea_devuelta td
          where td.task_id = c.id and td.de_quien = auth.uid()
        )
        -- Salvo que no haya nadie más a quien dársela: una tarea que nadie puede tomar es peor
        -- que una que vuelve a quien ya la tuvo.
        --
        -- «Nadie más» es quien de verdad podría: otro en turno y disponible, parado en el
        -- andén de esa tarea o en ninguno —el que no tiene andén toma de cualquiera—. No vale
        -- preguntar si hay alguien trabajando en la bodega, porque con treinta personas en
        -- otros andenes la respuesta es siempre sí y la tarea se quedaría parada esperando a
        -- que el jefe mueva a alguien, sin que nada lo diga.
        or not exists (
          select 1
          from shift_assignment sa
          where sa.ended_at is null
            and sa.paused_at is null
            and sa.profile_id <> auth.uid()
            and (
              sa.dock_door_id is null
              or exists (
                select 1
                from location l
                join dock_door d on d.id = sa.dock_door_id and l.code = 'STG-' || d.code
                where l.id in (c.from_location_id, c.to_location_id)
              )
            )
        )
      )
    order by c.priority desc, c.created_at
    limit 1
    for update skip locked
  )
  returning t.* into v_task;

  return v_task;
end;
$f$;

grant execute on function claim_next_task to authenticated;
