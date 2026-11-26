-- El montacargas es de piso o de rack, y son tareas distintas
--
-- El reparto filtraba por ALCANCE: «si el de rack llega al piso, mándale piso también».
--
--     and coalesce(c.min_level, 0) <= v_alcance
--
-- Con `alcance_de` devolviendo el `max_level` del equipo, eso le daba al montacarguista de
-- rack todas las tareas de piso además de las suyas. La regla de la bodega es la contraria y
-- está dicha: los de piso sólo a piso y los de rack sólo a rack, porque son tareas distintas.
-- Y no es un problema de cobertura: si no llegó el de rack, el supervisor le cambia de puesto
-- a alguien y le da el montacargas especial de rack. Para eso hace falta poder cambiar de
-- máquina sin salir del turno, que hasta hoy no se podía: el equipo era de sólo lectura dentro
-- del turno y había que salir y volver a entrar, soltando el andén y el rol de trabajo.
--
-- El corte está medido y es exacto: de las 5,605 posiciones activas, el nivel 0 son las 2,765
-- de piso más los 24 andenes, y los niveles 1 a 6 son las 2,816 de rack doble profundidad.
--
-- Así que el tipo de equipo pasa a declarar su FRANJA, no sólo su techo: `min_level` además de
-- `max_level`. El de piso es [0,0], el de rack [1,6], la transpaleta [0,0], y quien anda a pie
-- o con burro es [0,0] porque no hay fila de equipo y el coalesce lo deja en el piso.
--
-- Por qué la franja no rompe el surtido desde el rack, que era la duda: `task.min_level` es
-- siempre el nivel del EXTREMO DE RACK del movimiento, no del destino. Comprobado contra las
-- tareas de la base: un guardado de andén a nivel 1 lleva `min_level` 1 (su destino) y un
-- surtido de nivel 1 al andén lleva `min_level` 1 (su origen). El extremo difícil es el que
-- manda, que es justo lo que define quién puede hacerla.

alter table equipment_type
  add column if not exists min_level smallint not null default 0
    check (min_level between 0 and 12);

comment on column equipment_type.min_level is
  'Nivel más bajo que le toca a este equipo. El de rack no baja al piso: son tareas distintas.';

alter table equipment_type drop constraint if exists equipment_type_franja;
alter table equipment_type add constraint equipment_type_franja check (min_level <= max_level);

update equipment_type
set min_level = 1,
    -- Se llamaba «Montacargas de rack: alcanza rack y piso», que ahora miente dos veces.
    name = 'Montacargas de rack'
where code = 'MONTACARGA_RACK';

/**
 * El nivel más bajo que le toca a quien está en turno. Espejo de `alcance_de`.
 *
 * `join` y no `left join` a propósito: quien entró sin equipo no tiene fila de tipo, el
 * subselect no devuelve nada y el coalesce lo deja en 0, que es el piso.
 */
create or replace function nivel_minimo_de(p_profile_id uuid)
returns smallint
language sql stable security definer set search_path = public as $$
  select coalesce(
    (
      select min(t.min_level)
      from shift_assignment sa
      join equipment_type t on t.code = sa.equipment_type_code and t.is_active
      where sa.profile_id = p_profile_id and sa.ended_at is null
    ),
    0::smallint
  );
$$;

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
    order by c.priority desc, c.created_at
    limit 1
    for update skip locked
  )
  returning t.* into v_task;

  return v_task;
end;
$f$;
/**
 * La cola que explica por qué no le cayó nada.
 *
 * `al_alcance` dice sólo si llega, que es lo que era. Lo de la máquina va aparte, en
 * `de_mi_equipo`, porque las dos razones se le cuentan distinto a la persona: una es «está
 * demasiado alto para tu equipo» y la otra «eso es piso y andas en el de rack». Juntarlas en
 * `al_alcance` habría hecho que la pantalla le dijera al de rack que no alcanza el suelo.
 */
create or replace view task_queue as
  select
    t.id, t.type, t.status, t.priority, t.min_level, t.flow, t.created_at,
    t.product_id, t.qty_base, t.from_location_id, t.to_location_id,
    coalesce(t.min_level, 0) <= alcance_de(auth.uid()) as al_alcance,
    flujo_de(auth.uid()) in ('BOTH', coalesce(t.flow, flujo_de(auth.uid()))) as de_mi_flujo,
    t.type = 'COUNT' or coalesce(t.min_level, 0) >= nivel_minimo_de(auth.uid())
      as de_mi_equipo
  from task t
  where t.status = 'READY';

create or replace function reordenar(p_origen text, p_destino text, p_pallet text default null)
returns table(pallet text, sku text, nombre text, cantidad numeric, de text, a text)
language plpgsql security definer set search_path = public as $f$
declare
  v_origen text := upper(trim(coalesce(p_origen, '')));
  v_pallet text := nullif(upper(trim(coalesce(p_pallet, ''))), '');
  v_dest location;
  v_cuantos integer;
  v_min smallint;
  v_max smallint;
  v_nivel smallint;
  v_lista text;
  s record;
begin
  if v_origen = '' or coalesce(trim(p_destino), '') = '' then
    raise exception 'Escanea el lugar de donde sale y el lugar a donde va';
  end if;

  v_dest := destino_valido(p_destino);

  select count(*), string_agg(coalesce(h.lpn_code, 'suelto') || ' (' || h.sku || ')', ', ')
    into v_cuantos, v_lista
  from hay_en(v_origen) h
  where v_pallet is null or h.lpn_code = v_pallet;

  if v_cuantos = 0 then
    if v_pallet is not null then
      raise exception 'El pallet % no está en %', v_pallet, v_origen;
    end if;
    raise exception 'En % no hay nada que mover', v_origen;
  end if;

  if v_cuantos > 1 then
    raise exception
      'En % hay % cosas: %. Escanea la matrícula del pallet que vas a mover',
      v_origen, v_cuantos, v_lista;
  end if;

  select * into s
  from hay_en(v_origen) h
  where v_pallet is null or h.lpn_code = v_pallet;

  if s.location_id = v_dest.id then
    raise exception 'Ya está en %', v_dest.code;
  end if;
  if s.qty_allocated > 0 then
    raise exception
      'Eso está apartado para un pedido: termina el surtido o suéltalo antes de moverlo';
  end if;

  -- Y el montacargas que trae puesto. El reparto de tareas sí mira la máquina; esta pantalla
  -- no miraba nada: medido a clic el 25/11/2026, con un montacargas de piso se subió de verdad
  -- un pallet a un nivel 1 de rack, y quedó apuntado a nombre de quien no podía haberlo hecho.
  --
  -- Manda el extremo de rack del movimiento, igual que `task.min_level`: si uno de los dos
  -- lados está en alto, el movimiento es de rack. Así bajar de rack al piso sigue siendo del
  -- de rack —que es como se reabastece la cara a mano— y el de piso no sube nada.
  v_min := nivel_minimo_de(auth.uid());
  v_max := alcance_de(auth.uid());

  select greatest(coalesce(l.level, 0), coalesce(v_dest.level, 0)) into v_nivel
  from location l where l.id = s.location_id;

  if v_nivel > v_max then
    raise exception
      'Ese movimiento toca el nivel % y tu equipo no llega. Entra a trabajo con el montacargas de rack',
      v_nivel;
  end if;
  if v_nivel < v_min then
    raise exception
      'Ese movimiento es todo de piso y andas con el montacargas de rack: el piso lo mueve uno de piso';
  end if;

  if (select bool_or(segrega_no_alimento) from site)
     and v_dest.grupo is not null
     and v_dest.grupo <> grupo_del_producto(s.product_id)
  then
    if v_dest.grupo = 'NO_ALIMENTO' then
      raise exception 'Ahí sólo va lo que no es alimento. Busca otro hueco';
    end if;
    raise exception 'Eso no es alimento y ahí sí. Llévalo a su zona';
  end if;

  if exists (
    select 1 from stock st
    join location l on l.id = st.location_id
    where l.carril = v_dest.carril and st.qty_base > 0
      and (st.product_id <> s.product_id or st.lot is distinct from s.lot)
  ) then
    if v_dest.kind in ('rack_single', 'rack_double_deep') then
      raise exception
        'El frente y el fondo de esa bahía van juntos, y ahí hay otro producto o lote. Busca otro hueco';
    end if;
    raise exception 'En ese carril hay otro producto o lote. Busca otro hueco';
  end if;

  if s.lpn_id is not null and pallets_que_caben(v_dest.id, s.product_id) <= 0 then
    raise exception 'En % no cabe otro pallet de ese producto', v_dest.code;
  end if;

  perform post_movement(
    'MOVE', s.product_id, s.qty_base, s.location_id, v_dest.id, s.lpn_id, s.lot,
    s.expiry_date, 'TRASLADO'
  );

  return query
  select coalesce(s.lpn_code, 'suelto'), s.sku, s.nombre, s.qty_base, s.location_code,
         v_dest.code;
end;
$f$;

create or replace function iniciar_turno(
  p_tipo_equipo text default null,
  p_flow text default 'BOTH',
  p_rol user_role default null
)
returns shift_assignment
language plpgsql security definer set search_path = public as $f$
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

  -- De montacarguista no se trabaja «en general»: o es de piso o es de rack, y son tareas
  -- distintas. Sin decir con qué, entraba y el sistema le daba el piso en silencio.
  if coalesce(v_rol, (select role from profile where id = auth.uid())) = 'montacargista'
     and v_tipo.code is null
  then
    raise exception
      'Dime con qué montacargas vas: el de piso y el de rack no hacen las mismas tareas';
  end if;

  select dock_door_id into v_anden
  from shift_assignment
  where profile_id = auth.uid() and ended_at is null
  order by started_at desc
  limit 1;

  -- Lo empezado no se suelta ni frena la entrada: vuelve solo a la pantalla (0061).
  perform soltar_lo_no_empezado();

  -- Y de paso se cierran los turnos que quedaron encendidos, por si el reloj de la base
  -- falló: el de esta persona se cierra abajo, pero el de quien no ha vuelto, no.
  perform cerrar_turnos_vencidos();

  update shift_assignment set ended_at = clock_timestamp()
  where profile_id = auth.uid() and ended_at is null;

  insert into shift_assignment (profile_id, equipment_type_code, flow, working_role, dock_door_id)
  values (auth.uid(), v_tipo.code, p_flow, v_rol, v_anden)
  returning * into v_turno;

  return v_turno;
end;
$f$;

drop function if exists trabajar_como(user_role);

create or replace function trabajar_como(p_rol user_role, p_tipo_equipo text default null)
returns shift_assignment
language plpgsql security definer set search_path = public as $$
declare
  v_turno shift_assignment;
  v_tipo equipment_type;
begin
  if not puede_trabajar_como(p_rol) then
    raise exception 'No puedes trabajar como %: pídele al jefe que te lo conceda', p_rol;
  end if;

  select * into v_turno
  from shift_assignment
  where profile_id = auth.uid() and ended_at is null
  for update;

  if not found then
    raise exception 'Primero entra a trabajar';
  end if;

  if nullif(trim(coalesce(p_tipo_equipo, '')), '') is not null then
    select * into v_tipo from equipment_type
    where code = upper(trim(p_tipo_equipo)) and is_active;
    if not found then
      raise exception 'El tipo de equipo % no existe', p_tipo_equipo;
    end if;
  end if;

  if p_rol = 'montacargista' and v_tipo.code is null then
    raise exception
      'Dime con qué montacargas vas: el de piso y el de rack no hacen las mismas tareas';
  end if;
  if coalesce(v_turno.working_role, (select role from profile where id = auth.uid())) = p_rol
     and coalesce(v_tipo.code, '') = coalesce(v_turno.equipment_type_code, '')
  then
    raise exception 'Ya estás trabajando como %', p_rol;
  end if;

  perform soltar_tareas_del_turno();

  -- La máquina va con el oficio: quien deja de ser montacarguista entrega el montacargas.
  -- Si se quedara puesto, el que baja a ayudar de auxiliar seguiría con el filtro de rack y no
  -- le caería nada del piso.
  update shift_assignment set working_role = p_rol, equipment_type_code = v_tipo.code
  where id = v_turno.id
  returning * into v_turno;

  return v_turno;
end;
$$;

/**
 * Cambiar de montacargas sin salir del turno.
 *
 * Es el caso que manda el dueño de la bodega: no llegó el de rack, el supervisor le cambia de
 * puesto a alguien y le da la máquina de rack. El rol no se mueve —ya es montacarguista—, lo
 * que cambia es con qué anda, y con eso qué tareas le caen.
 *
 * Suelta lo asignado sin empezar, igual que `trabajar_como`: esas tareas eran de la máquina
 * que acaba de entregar.
 */
create or replace function cambiar_equipo(p_tipo_equipo text default null)
returns shift_assignment
language plpgsql security definer set search_path = public as $f$
declare
  v_turno shift_assignment;
  v_tipo equipment_type;
begin
  select * into v_turno
  from shift_assignment
  where profile_id = auth.uid() and ended_at is null
  for update;

  if not found then
    raise exception 'Primero entra a trabajar';
  end if;

  if nullif(trim(coalesce(p_tipo_equipo, '')), '') is not null then
    select * into v_tipo from equipment_type
    where code = upper(trim(p_tipo_equipo)) and is_active;
    if not found then
      raise exception 'El tipo de equipo % no existe', p_tipo_equipo;
    end if;
  end if;

  if coalesce(v_tipo.code, '') = coalesce(v_turno.equipment_type_code, '') then
    raise exception 'Ya andas con eso';
  end if;

  if coalesce(v_turno.working_role, (select role from profile where id = auth.uid()))
       = 'montacargista'
     and v_tipo.code is null
  then
    raise exception
      'Trabajando de montacarguista tienes que andar con un montacargas. Si vas a pie, cámbiate de rol';
  end if;

  perform soltar_tareas_del_turno();

  update shift_assignment set equipment_type_code = v_tipo.code
  where id = v_turno.id
  returning * into v_turno;

  return v_turno;
end;
$f$;

grant execute on function nivel_minimo_de(uuid), cambiar_equipo(text) to authenticated;
grant execute on function trabajar_como(user_role, text) to authenticated;
