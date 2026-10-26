/**
 * Empieza el guardado. El operario escanea la matricula del pallet que tomo:
 * si no es la que pedia la tarea, se detiene antes de mover nada.
 * Marca started_at, que es lo que separa el viaje de la ejecucion en los KPI.
 */
create function start_putaway(p_task_id uuid, p_lpn_code text) returns task
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
  if v_task.status <> 'ASSIGNED' then
    raise exception 'La tarea ya empezo o esta cerrada';
  end if;
  if v_esperado is distinct from trim(p_lpn_code) then
    raise exception 'Ese no es el pallet de esta tarea. Buscas el %', v_esperado;
  end if;

  update task set status = 'IN_PROGRESS', started_at = now()
  where id = p_task_id
  returning * into v_task;

  return v_task;
end;
$$;

/**
 * Cierra el guardado contra la posicion que el operario escaneo. Acepta una
 * distinta a la sugerida si es valida: en piso pasa que el hueco previsto no
 * sirve. Lo que no acepta es una posicion que rompa las reglas.
 */
create function complete_putaway(p_task_id uuid, p_location_code text)
returns table (location_code text, era_la_sugerida boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_task task;
  v_dest location;
begin
  select * into v_task from task where id = p_task_id;

  if not found then
    raise exception 'La tarea no existe';
  end if;
  if v_task.assigned_to is distinct from auth.uid() then
    raise exception 'Esa tarea no es tuya';
  end if;
  if v_task.status <> 'IN_PROGRESS' then
    raise exception 'Primero escanea el pallet';
  end if;

  select * into v_dest from location where code = trim(p_location_code);

  if not found then
    raise exception 'No existe la posicion %', p_location_code;
  end if;
  if v_dest.retired_at is not null or v_dest.status <> 'available' then
    raise exception 'La posicion % no esta disponible', v_dest.code;
  end if;
  if v_dest.reserved_by_task_id is not null and v_dest.reserved_by_task_id <> p_task_id then
    raise exception 'La posicion % esta apartada para otra tarea', v_dest.code;
  end if;

  if exists (
    select 1 from stock s join location l on l.id = s.location_id
    where l.lane_id = v_dest.lane_id and s.qty_base > 0
      and (s.product_id <> v_task.product_id or s.lot is distinct from v_task.lot)
  ) then
    raise exception 'En ese carril hay otro producto o lote. Busca otro hueco';
  end if;

  perform post_movement(
    'PUTAWAY', v_task.product_id, v_task.qty_base, v_task.from_location_id, v_dest.id,
    v_task.lpn_id, v_task.lot, v_task.expiry_date, null, null, v_task.packaging_level_id,
    p_task_id, null, 'putaway-' || p_task_id::text
  );

  update task
  set status = 'DONE', completed_at = now(), to_location_id = v_dest.id
  where id = p_task_id;

  update location set reserved_by_task_id = null, reserved_until = null
  where reserved_by_task_id = p_task_id;

  return query select v_dest.code, v_dest.id = v_task.to_location_id;
end;
$$;

grant execute on function start_putaway, complete_putaway to authenticated;
