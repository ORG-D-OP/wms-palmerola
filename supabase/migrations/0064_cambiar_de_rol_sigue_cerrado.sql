/**
 * Corrige la migración 0061: lo que había que abrir era **entrar a trabajo**, no cambiarse
 * de rol.
 *
 * 0061 le quitó el freno a `soltar_tareas_del_turno` para romper el encierro, y de paso se
 * llevó por delante la regla de `trabajar_como`: el supervisor que baja a ayudar con un
 * pallet a medio camino sí tiene que dejarlo antes, porque ahí el pallet está físicamente en
 * sus manos y el cambio de rol es voluntario. Entrar a trabajo no: eso es justo lo que hace
 * quien vuelve a la pantalla después de que se le cayó.
 *
 * Así que la regla vuelve a su sitio y `iniciar_turno` suelta sólo lo no empezado.
 */
create or replace function soltar_tareas_del_turno() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_curso integer;
begin
  select count(*) into v_curso
  from task where assigned_to = auth.uid() and status = 'IN_PROGRESS';

  if v_curso > 0 then
    raise exception 'Termina primero lo que tienes empezado: % tarea(s) en curso', v_curso;
  end if;

  return soltar_lo_no_empezado();
end;
$$;

/** Lo asignado y sin empezar vuelve libre a la cola: ya no es trabajo de quien se fue. */
create or replace function soltar_lo_no_empezado() returns integer
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

grant execute on function soltar_lo_no_empezado to authenticated;

create or replace function iniciar_turno(
  p_tipo_equipo text default null,
  p_flow text default 'BOTH',
  p_rol user_role default null
)
returns shift_assignment
language plpgsql security definer set search_path = public as $$
declare
  v_tipo equipment_type;
  v_anden uuid;
  v_turno shift_assignment;
  v_rol user_role := p_rol;
begin
  if auth.uid() is null then
    raise exception 'Hace falta una sesión para iniciar turno';
  end if;
  if p_flow not in ('INBOUND', 'OUTBOUND', 'BOTH') then
    raise exception 'El flujo tiene que ser ingreso, despacho o los dos';
  end if;

  if v_rol is not null and not puede_trabajar_como(v_rol) then
    raise exception 'No puedes trabajar como %: pídele al jefe que te lo conceda', v_rol;
  end if;

  if p_tipo_equipo is not null then
    select * into v_tipo from equipment_type
    where code = upper(trim(p_tipo_equipo)) and is_active;
    if not found then
      raise exception 'El tipo de equipo % no existe', p_tipo_equipo;
    end if;
  end if;

  select dock_door_id into v_anden
  from shift_assignment
  where profile_id = auth.uid() and ended_at is null
  order by started_at desc
  limit 1;

  -- Lo empezado no se suelta ni frena la entrada: vuelve solo a la pantalla (0061).
  perform soltar_lo_no_empezado();

  update shift_assignment set ended_at = clock_timestamp()
  where profile_id = auth.uid() and ended_at is null;

  insert into shift_assignment (profile_id, equipment_type_code, flow, working_role, dock_door_id)
  values (auth.uid(), v_tipo.code, p_flow, v_rol, v_anden)
  returning * into v_turno;

  return v_turno;
end;
$$;
