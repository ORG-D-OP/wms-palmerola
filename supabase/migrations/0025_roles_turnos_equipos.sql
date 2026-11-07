/**
 * Los roles del enum salieron de suponer como trabaja la bodega. El correo de Francisco
 * dice como trabaja de verdad: 25 auxiliares, 9 chequeadores y 5 montacarguistas, mas la
 * supervision. El auxiliar hace el trabajo fisico de los dos lados —baja y surte—; el
 * chequeador verifica y cuenta; el montacarguista mueve pallets con equipo.
 */
alter type user_role rename value 'operador_recibo' to 'auxiliar';
alter type user_role rename value 'operador_picking' to 'chequeador';

comment on type user_role is
  '25 auxiliares, 9 chequeadores, 5 montacarguistas (correo de Francisco, nov 2026)';

-- ---------------------------------------------------------------------------------------
-- El turno: con que equipo trabaja hoy cada persona y de que lado
-- ---------------------------------------------------------------------------------------

/**
 * El alcance no se deduce del rol: un montacargas de rack alcanza el piso, asi que la
 * relacion es de inclusion y el filtro va por `max_level`, nunca por nombre de rol.
 *
 * Sin turno abierto el alcance es 0: se puede trabajar en piso, no en rack. Asi el sistema
 * sirve desde el primer dia y se vuelve estricto en cuanto el jefe de bodega registre la
 * flota, sin inventar cuantos montacargas hay de cada tipo.
 */
create function alcance_de(p_profile_id uuid) returns smallint
language sql stable set search_path = public as $$
  select coalesce(
    (
      select t.max_level
      from shift_assignment sa
      join equipment e on e.id = sa.equipment_id
      join equipment_type t on t.code = e.type_code
      where sa.profile_id = p_profile_id and sa.ended_at is null and e.is_active
    ),
    0::smallint
  );
$$;

/** El lado de la operacion que le toca hoy. BOTH cuando no hay turno abierto. */
create function flujo_de(p_profile_id uuid) returns text
language sql stable set search_path = public as $$
  select coalesce(
    (select flow from shift_assignment where profile_id = p_profile_id and ended_at is null),
    'BOTH'
  );
$$;

create function iniciar_turno(p_equipment_code text default null, p_flow text default 'BOTH')
returns shift_assignment
language plpgsql security definer set search_path = public as $$
declare
  v_equipo equipment;
  v_turno shift_assignment;
begin
  if auth.uid() is null then
    raise exception 'Hace falta una sesion para iniciar turno';
  end if;
  if p_flow not in ('INBOUND', 'OUTBOUND', 'BOTH') then
    raise exception 'El flujo tiene que ser ingreso, despacho o los dos';
  end if;

  if p_equipment_code is not null then
    select * into v_equipo from equipment where code = trim(p_equipment_code) and is_active;
    if not found then
      raise exception 'El equipo % no existe o está fuera de servicio', p_equipment_code;
    end if;
    if exists (
      select 1 from shift_assignment
      where equipment_id = v_equipo.id and ended_at is null and profile_id <> auth.uid()
    ) then
      raise exception 'El equipo % ya lo tiene otra persona', v_equipo.code;
    end if;
  end if;

  update shift_assignment set ended_at = clock_timestamp()
  where profile_id = auth.uid() and ended_at is null;

  insert into shift_assignment (profile_id, equipment_id, flow)
  values (auth.uid(), v_equipo.id, p_flow)
  returning * into v_turno;

  return v_turno;
end;
$$;

create function cerrar_turno() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  update shift_assignment set ended_at = clock_timestamp()
  where profile_id = auth.uid() and ended_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

grant execute on function alcance_de, flujo_de, iniciar_turno, cerrar_turno to authenticated;

-- ---------------------------------------------------------------------------------------
-- La cola, filtrada por lo que la persona puede hacer de verdad
-- ---------------------------------------------------------------------------------------

/**
 * Antes la cola filtraba por tipo y por zona, asi que un montacargas de piso podia recibir
 * una tarea del nivel 3 de un rack, caminar hasta alla y descubrir que no alcanza.
 *
 * Ahora la cola respeta el alcance del equipo del turno y el lado de la operacion. El
 * reparto mitad ingreso y mitad despacho se hace poniendo `flow` en los turnos; no hay
 * tareas intercaladas, cada quien atiende las suyas.
 */
create or replace function claim_next_task(
  p_types task_type[] default null,
  p_zone_ids uuid[] default null
) returns task
language plpgsql security definer set search_path = public as $$
declare
  v_task task;
  v_alcance smallint;
  v_flujo text;
begin
  if auth.uid() is null then
    raise exception 'Hace falta una sesion para tomar trabajo';
  end if;

  v_alcance := alcance_de(auth.uid());
  v_flujo := flujo_de(auth.uid());

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
    order by c.priority desc, c.created_at
    limit 1
    for update skip locked
  )
  returning t.* into v_task;

  return v_task;
end;
$$;

/** Lo que hay en la cola para una persona, para poder decirle por que no le toca nada. */
create view task_queue as
  select
    t.id, t.type, t.status, t.priority, t.min_level, t.flow, t.created_at,
    t.product_id, t.qty_base, t.from_location_id, t.to_location_id,
    coalesce(t.min_level, 0) <= alcance_de(auth.uid()) as al_alcance,
    flujo_de(auth.uid()) in ('BOTH', coalesce(t.flow, flujo_de(auth.uid()))) as de_mi_flujo
  from task t
  where t.status = 'READY';

grant select on task_queue to authenticated;
