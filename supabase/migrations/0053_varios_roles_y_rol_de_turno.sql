/**
 * Una persona puede tener más de un rol, y el rol con el que trabaja hoy es del turno.
 *
 * Dos cosas que la bodega pidió y que el modelo de un solo rol por persona no aguanta.
 *
 * **1. Vacaciones.** Un auxiliar cubre de chequeador mientras el chequeador está de
 * vacaciones. Hoy habría que cambiarle el rol y acordarse de devolvérselo, y mientras tanto
 * pierde lo que sabía hacer. Ahora el jefe le **concede** roles además del suyo: los permisos
 * son la unión, así que cubrir no quita nada.
 *
 * **2. El supervisor que baja a ayudar.** «El supervisor debería poder cambiarse su rol pero
 * sin perder los permisos, para poder ayudar cuando hay mucha carga.» Antes `cambiar_rol`
 * prohibía tocarse el rol a sí mismo —con razón: si se baja a auxiliar, se queda sin la
 * pantalla con la que volver a subirse—. La salida no es permitirle degradarse: es que **el
 * rol con el que se trabaja no sea el mismo dato que el rango**.
 *
 * Así quedan separados:
 *
 * - `profile.role` — el **rango**. De aquí salen los permisos, y sólo el jefe lo cambia. No
 *   cambia nunca por ponerse a trabajar.
 * - `profile.roles_extra` — lo que el jefe **concede** además, para cubrir. Suma permisos.
 * - `shift_assignment.working_role` — **con qué rol está trabajando ahora**. Vive en el turno,
 *   así que se acaba cuando se acaba el turno y queda el rastro de quién cubrió qué.
 *
 * Y de paso, el montacargas: se elige el **tipo**, no la unidad. La flota está vacía
 * (`equipment` tiene cero filas), así que hoy `alcance_de` da 0 para todo el mundo y **nadie
 * puede recibir una tarea de rack**. Pidiendo el tipo el sistema sirve sin inventariar la
 * flota, y un montacarguista de rack puede declararse de piso cuando se acumula el trabajo de
 * piso, que es lo que se pidió.
 */

alter table profile
  add column if not exists roles_extra user_role[] not null default '{}';

comment on column profile.role is
  'El rango: de aquí salen los permisos. No cambia por ponerse a trabajar en otra cosa.';
comment on column profile.roles_extra is
  'Roles que el jefe concede además del rango, para cubrir vacaciones. Suman permisos.';

alter table shift_assignment
  add column if not exists working_role user_role,
  add column if not exists equipment_type_code text references equipment_type on delete restrict;

comment on column shift_assignment.working_role is
  'Con qué rol está trabajando en este turno. Null es su rango.';
comment on column shift_assignment.equipment_type_code is
  'El tipo de equipo que declaró al entrar. Sin unidad y sin exclusividad: lo que importa es el alcance.';

/**
 * Todos los roles de quien pregunta: el rango más los concedidos. Vacío si la cuenta está
 * apagada o no existe, que es lo que mantiene en pie el arreglo de 0049 (un null aquí dejaba
 * pasar a las cuentas sin aceptar).
 */
create or replace function roles_de_la_sesion() returns user_role[]
language sql stable security definer set search_path = public as $$
  select array_append(p.roles_extra, p.role)
  from profile p
  where p.id = auth.uid() and p.is_active;
$$;

/** Ahora alcanza con tener **alguno** de los roles que se piden. */
create or replace function has_role(variadic roles user_role[]) returns boolean
language sql stable as $$
  select coalesce(roles_de_la_sesion() && roles, false);
$$;

grant execute on function roles_de_la_sesion to authenticated;

/**
 * El jefe concede roles para cubrir. No se toca el rango: para eso está `cambiar_rol`, y
 * sigue prohibido hacérselo a uno mismo.
 */
create or replace function conceder_roles(p_id uuid, p_roles user_role[]) returns profile
language plpgsql security definer set search_path = public as $$
declare
  v profile;
  r user_role;
begin
  if not manda_sobre_personal() then
    raise exception 'No tienes permiso para conceder roles';
  end if;

  select * into v from profile where id = p_id for update;
  if not found then
    raise exception 'Esa persona no existe';
  end if;
  if v.role = 'admin' and not has_role('admin') then
    raise exception 'Sólo un administrador le toca los roles a otro';
  end if;

  foreach r in array coalesce(p_roles, '{}'::user_role[]) loop
    if not rol_asignable(r) then
      raise exception 'No puedes conceder el rol %', r;
    end if;
  end loop;

  update profile
     set roles_extra = (
       select coalesce(array_agg(distinct x order by x), '{}'::user_role[])
       from unnest(coalesce(p_roles, '{}'::user_role[])) as x
       where x <> v.role
     )
   where id = p_id
  returning * into v;

  return v;
end;
$$;

grant execute on function conceder_roles to authenticated;

/**
 * Con qué rol puede ponerse a trabajar alguien.
 *
 * El supervisor y el administrador pueden cualquiera de los operativos sin que nadie se lo
 * conceda: es justamente el caso de bajar a ayudar, y no tiene sentido que el jefe tenga que
 * concederse permiso a sí mismo. Los demás, su rango y lo concedido.
 */
create or replace function puede_trabajar_como(p_role user_role) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_role in ('solo_lectura', 'inventarios') then false
    when has_role('supervisor', 'admin') then true
    else coalesce(roles_de_la_sesion() && array[p_role], false)
  end;
$$;

grant execute on function puede_trabajar_como to authenticated;

/** El rol con el que está trabajando ahora. Sin turno abierto, su rango. */
create or replace function rol_de_trabajo(p_profile_id uuid) returns user_role
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select sa.working_role from shift_assignment sa
      where sa.profile_id = p_profile_id and sa.ended_at is null and sa.working_role is not null),
    (select p.role from profile p where p.id = p_profile_id)
  );
$$;

grant execute on function rol_de_trabajo to authenticated;

/**
 * Suelta lo que la persona tenía asignado y no había empezado. Se rechaza si anda con algo en
 * curso: un pallet a medio camino no se queda sin dueño.
 */
create or replace function soltar_tareas_del_turno() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_curso integer;
  v_n integer;
begin
  select count(*) into v_curso
  from task where assigned_to = auth.uid() and status = 'IN_PROGRESS';

  if v_curso > 0 then
    raise exception 'Termina primero lo que tienes empezado: % tarea(s) en curso', v_curso;
  end if;

  update task set status = 'READY', assigned_to = null, assigned_at = null
  where assigned_to = auth.uid() and status = 'ASSIGNED';

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

/**
 * El alcance sale del **tipo** declarado en el turno. Se sigue mirando la unidad cuando el
 * turno trae una, para no romper los turnos que ya estaban abiertos.
 */
create or replace function alcance_de(p_profile_id uuid) returns smallint
language sql stable set search_path = public as $$
  select coalesce(
    (
      select max(t.max_level)
      from shift_assignment sa
      left join equipment_type t on t.code = sa.equipment_type_code and t.is_active
      left join equipment e on e.id = sa.equipment_id and e.is_active
      left join equipment_type te on te.code = e.type_code and te.is_active
      where sa.profile_id = p_profile_id and sa.ended_at is null
    ),
    0::smallint
  );
$$;

/**
 * Entrar a trabajar: con qué rol, con qué tipo de equipo y de qué lado.
 *
 * Cambia respecto de 0025: el equipo es un **tipo**, no una unidad, y no hay exclusividad
 * —«que no se limite la cantidad de montacarguistas al mismo tiempo»—. Y conserva el andén
 * donde el jefe paró a la persona: volver a entrar a trabajar no es irse del andén.
 */
drop function if exists iniciar_turno(text, text);

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

  perform soltar_tareas_del_turno();

  update shift_assignment set ended_at = clock_timestamp()
  where profile_id = auth.uid() and ended_at is null;

  insert into shift_assignment (profile_id, equipment_type_code, flow, working_role, dock_door_id)
  values (auth.uid(), v_tipo.code, p_flow, v_rol, v_anden)
  returning * into v_turno;

  return v_turno;
end;
$$;

/**
 * Cambiarse de rol a media mañana, que es el caso del supervisor que baja a ayudar.
 *
 * Nadie deja tareas a medias: si anda con algo empezado, no se cambia hasta dejarlo. Lo que
 * tenía asignado y sin empezar vuelve libre a la cola, porque ya no es trabajo suyo. Misma
 * regla que mover a alguien de andén (0043).
 */
create or replace function trabajar_como(p_rol user_role) returns shift_assignment
language plpgsql security definer set search_path = public as $$
declare
  v_turno shift_assignment;
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
  if coalesce(v_turno.working_role, (select role from profile where id = auth.uid())) = p_rol then
    raise exception 'Ya estás trabajando como %', p_rol;
  end if;

  perform soltar_tareas_del_turno();

  update shift_assignment set working_role = p_rol
  where id = v_turno.id
  returning * into v_turno;

  return v_turno;
end;
$$;


grant execute on function iniciar_turno, trabajar_como, soltar_tareas_del_turno to authenticated;

/** El jefe necesita ver con qué rol anda cada quien, no sólo cuál es su rango. */
create or replace view disponibles as
  select
    p.id,
    p.full_name,
    p.role,
    sa.started_at,
    sa.paused_at is null as disponible,
    sa.pause_note,
    coalesce(t.name, e.code) as equipo,
    d.code as anden,
    d.direction as anden_lado,
    rol_de_trabajo(p.id) as rol_trabajo,
    p.roles_extra,
    alcance_de(p.id) as alcance
  from shift_assignment sa
  join profile p on p.id = sa.profile_id
  left join equipment_type t on t.code = sa.equipment_type_code
  left join equipment e on e.id = sa.equipment_id
  left join dock_door d on d.id = sa.dock_door_id
  where sa.ended_at is null;

/**
 * Y la persona necesita ver con qué está trabajando. El tipo manda sobre la unidad: la unidad
 * sigue ahí sólo por los turnos que ya estaban abiertos cuando esto cambió.
 */
create or replace view mi_trabajo as
  select
    sa.profile_id,
    sa.started_at,
    sa.paused_at,
    sa.pause_note,
    sa.flow,
    coalesce(tt.code, e.code) as equipo,
    coalesce(tt.name, te.name) as tipo_equipo,
    coalesce(tt.max_level, te.max_level) as alcance,
    d.code as anden,
    rol_de_trabajo(sa.profile_id) as rol_trabajo
  from shift_assignment sa
  left join equipment_type tt on tt.code = sa.equipment_type_code
  left join equipment e on e.id = sa.equipment_id
  left join equipment_type te on te.code = e.type_code
  left join dock_door d on d.id = sa.dock_door_id
  where sa.ended_at is null;

/**
 * El jefe no puede conceder roles si no ve cuáles tiene concedidos cada quien. La función
 * cambia de firma, así que hay que tirarla primero: en Postgres no se le añade una columna al
 * `returns table` con `create or replace`.
 */
drop function if exists listar_personal();

create or replace function listar_personal()
returns table (
  id uuid,
  full_name text,
  employee_code text,
  email text,
  role user_role,
  roles_extra user_role[],
  is_active boolean,
  approved_at timestamptz,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not manda_sobre_personal() then
    raise exception 'No tienes permiso para ver el personal';
  end if;

  return query
  select p.id, p.full_name, p.employee_code, u.email::text, p.role, p.roles_extra, p.is_active,
         p.approved_at, p.created_at
  from profile p
  join auth.users u on u.id = p.id
  order by (p.approved_at is null) desc, p.is_active desc, p.full_name;
end;
$$;

grant execute on function listar_personal to authenticated;
