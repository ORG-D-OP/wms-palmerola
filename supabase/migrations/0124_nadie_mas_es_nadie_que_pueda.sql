/**
 * «Nadie más» es nadie a quien la cola se la daría, no nadie.
 *
 * La 0123 dejó de devolverle una tarea a quien se la quitaron, con una salida para que no se
 * quedara sin dueño: si no hay nadie más, le vuelve a caer. Pero esa salida **contaba
 * personas**, y esta cola no reparte por personas: reparte por rol, por máquina, por nivel y
 * por lado de la operación. Así que bastaba con que hubiera alguien incapaz de tomarla para
 * que la tarea no volviera a quien sí podía, y entonces no la hacía nadie.
 *
 * Los casos, los tres probados y el cuarto que salió al revisarlo:
 *
 *   - Un **chequeador** parado en ese andén. `tareas_de('chequeador')` es un array vacío: a él
 *     no le cae ninguna tarea, nunca.
 *   - Un **montacargas de piso** con una tarea de rack, o al revés. El nivel y la franja de la
 *     máquina la descartan.
 *   - Alguien en turno de **despacho** con una tarea de ingreso. El flujo la descarta.
 *   - Y un **supervisor o un admin** en turno sin bajar a ayudar: `tareas_de` les da todos los
 *     tipos, pero `es_rol_de_trabajo` los deja fuera de la cola, así que tampoco cuentan.
 *
 * En los cuatro, la tarea se quedaba `READY` para siempre: el jefe la veía libre en su reparto
 * y ningún trabajador podía tomarla. Era justo el callejón que la 0123 decía evitar.
 *
 * Ahora el candidato pasa por los mismos filtros que la cola: `es_rol_de_trabajo`, `tareas_de`,
 * `alcance_de`, `nivel_minimo_de` y `flujo_de`, además del andén. Si nadie los pasa, la tarea
 * vuelve a quien la devolvió, que es la salida que la 0123 quería.
 *
 * Cuesta poco: esa rama sólo se evalúa para las tareas que esta persona devolvió, que son
 * pocas y están indizadas por `tarea_devuelta_task_idx`.
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
        -- Salvo que no quede nadie a quien dársela: una tarea que nadie puede tomar es peor
        -- que una que vuelve a quien ya la tuvo.
        --
        -- «Nadie» es nadie **a quien esta cola se la daría**, y eso son los cinco filtros que
        -- ella misma aplica más arriba, aplicados al candidato: que su rol de hoy reciba
        -- tareas, que reciba las de este tipo, que alcance el nivel, que la máquina sea la de
        -- esa altura, y que esté del lado de la operación que toca. Más el andén.
        or not exists (
          select 1
          from shift_assignment sa
          where sa.ended_at is null
            and sa.paused_at is null
            and sa.profile_id <> auth.uid()
            and es_rol_de_trabajo(rol_de_trabajo(sa.profile_id))
            and c.type = any(tareas_de(rol_de_trabajo(sa.profile_id)))
            and coalesce(c.min_level, 0) <= alcance_de(sa.profile_id)
            and (
              c.type = 'COUNT'
              or coalesce(c.min_level, 0) >= nivel_minimo_de(sa.profile_id)
            )
            and (
              flujo_de(sa.profile_id) = 'BOTH'
              or c.flow is null
              or c.flow = flujo_de(sa.profile_id)
            )
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
