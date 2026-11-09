/**
 * Mover a alguien de andén sin que se le pierdan las tareas ni se le cancele lo que anda
 * haciendo.
 *
 * El primer intento (0041) sólo cambiaba el andén y dejaba el resto al filtro de la cola. El
 * agujero es fácil de ver: la persona arrastraba consigo todo lo que tenía asignado, así que
 * pasearla por los quince andenes la dejaba con quince tareas encima y los andenes vacíos.
 *
 * Lo correcto es que **las tareas son del andén, no de la persona**. Al moverla:
 *  - lo que tenía asignado y **no había empezado** vuelve a la cola de su andén, libre, para
 *    que se lo lleve el siguiente que pida trabajo ahí;
 *  - lo que ya **empezó** no se toca. Cancelarle una tarea a alguien que va con un pallet en
 *    las uñas es dejar un pallet a medio camino sin dueño y sin registro. La termina donde
 *    está, y la siguiente ya le cae del andén nuevo.
 */
-- Cambia lo que devuelve, asi que no se puede reemplazar en caliente.
drop function if exists asignar_anden(uuid, text);

create function asignar_anden(p_profile_id uuid, p_anden text default null)
returns table (anden text, liberadas integer, en_curso text)
language plpgsql security definer set search_path = public as $$
declare
  v_anden uuid;
  v_codigo text;
  v_turno shift_assignment;
  v_liberadas integer;
  v_curso text;
begin
  if not has_role('supervisor', 'admin') then
    raise exception 'Sólo el jefe de bodega reparte la gente entre andenes';
  end if;

  if nullif(trim(coalesce(p_anden, '')), '') is not null then
    select id, code into v_anden, v_codigo from dock_door where code = trim(p_anden);
    if v_anden is null then
      raise exception 'No hay ningún andén con el código %', trim(p_anden);
    end if;
  end if;

  select * into v_turno
  from shift_assignment
  where profile_id = p_profile_id and ended_at is null
  for update;

  if not found then
    raise exception 'Esa persona no está trabajando ahora mismo';
  end if;
  if v_turno.dock_door_id is not distinct from v_anden then
    raise exception 'Esa persona ya está ahí';
  end if;

  -- Lo asignado y no empezado vuelve a la cola, libre. El orden importa: primero se suelta
  -- lo del andén viejo, después se cambia el andén.
  with sueltas as (
    update task
    set status = 'READY', assigned_to = null, assigned_at = null
    where assigned_to = p_profile_id and status = 'ASSIGNED'
    returning 1
  )
  select count(*)::integer into v_liberadas from sueltas;

  select l.code into v_curso
  from task t
  left join location l on l.id = coalesce(t.to_location_id, t.from_location_id)
  where t.assigned_to = p_profile_id and t.status = 'IN_PROGRESS'
  limit 1;

  update shift_assignment set dock_door_id = v_anden where id = v_turno.id;

  return query select v_codigo, v_liberadas, v_curso;
end;
$$;

grant execute on function asignar_anden to authenticated;

/**
 * Cuánto trabajo hay parado en cada andén y quién está ahí para hacerlo.
 *
 * Es lo que el jefe de bodega necesita para decidir a quién mueve: no sirve saber que hay
 * 40 tareas abiertas en la bodega, sirve saber que 31 están en el andén 6 y que ahí hay una
 * sola persona. Una tarea cuenta en el andén donde empieza o termina, que para guardar es de
 * donde sale el pallet y para surtir es a dónde va.
 */
create or replace view carga_por_anden as
  with tareas as (
    select
      d.code as anden,
      count(*) filter (where t.status = 'READY')::integer as libres,
      count(*) filter (where t.status = 'ASSIGNED')::integer as asignadas,
      count(*) filter (where t.status = 'IN_PROGRESS')::integer as en_curso
    from dock_door d
    join location l on l.code = 'STG-' || d.code
    join task t
      on l.id in (t.from_location_id, t.to_location_id)
      and t.status in ('READY', 'ASSIGNED', 'IN_PROGRESS')
    group by d.code
  ),
  gente as (
    select d.code as anden, count(*)::integer as personas
    from shift_assignment sa
    join dock_door d on d.id = sa.dock_door_id
    where sa.ended_at is null and sa.paused_at is null
    group by d.code
  )
  select
    d.code as anden,
    d.direction,
    coalesce(t.libres, 0) as libres,
    coalesce(t.asignadas, 0) as asignadas,
    coalesce(t.en_curso, 0) as en_curso,
    coalesce(g.personas, 0) as personas
  from dock_door d
  left join tareas t on t.anden = d.code
  left join gente g on g.anden = d.code
  where d.is_active;

grant select on carga_por_anden to authenticated;
