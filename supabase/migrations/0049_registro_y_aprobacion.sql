/**
 * Quién entra a la bodega: registro con código y visto bueno del jefe.
 *
 * Hasta ahora las altas las hacía un administrador por línea de comandos, con un correo de
 * Dinant. Eso no cubre la bodega real: buena parte de la gente es subcontratada y no tiene
 * correo de la empresa, así que el correo no prueba nada —cualquiera se registra con uno— y
 * el administrador tampoco es quien sabe a quién contrataron esta semana.
 *
 * Quien sí lo sabe es el jefe de bodega. Así que la persona se registra sola y **el jefe es la
 * verificación**: la cuenta existe desde el primer momento, puede iniciar sesión, y no ve
 * absolutamente nada hasta que supervisión la acepta y le pone rol.
 *
 * Dos cosas mandan en el diseño:
 *
 * El registro **no manda correo**. El proyecto tiene un tope de dos correos por hora y no hay
 * servidor propio de correo; con 39 personas dándose de alta, un flujo por correo se atasca el
 * primer día. Y no hace falta: confirmar un buzón no dice quién es la persona, y el jefe sí. El
 * correo queda como nombre de usuario y nada más.
 *
 * El alta pública de Supabase **sigue apagada**. Si se abriera, cualquiera podría crear cuentas
 * llamando a la API directamente y el código de bodega no serviría de nada. La única puerta es
 * la pantalla de registro, que valida el código antes de crear a nadie.
 */

/**
 * Primero, un agujero que este cambio destapa.
 *
 * `has_role` devolvía **null** —no `false`— cuando quien pregunta no tiene rol activo, porque
 * `current_role_name()` da null y `null = any(...)` es null. Y en Postgres `if not null then`
 * no entra. O sea que cada comprobación escrita como `if not has_role(...) then raise` dejaba
 * pasar a una cuenta sin rol activo, en todo el sistema.
 *
 * Nunca se pudo alcanzar porque hasta hoy toda cuenta nacía activa. Desde esta migración
 * existen cuentas registradas y sin aceptar, así que pasa a ser alcanzable. Las políticas de
 * RLS nunca estuvieron expuestas —ahí un null no concede—, sólo las comprobaciones de las
 * funciones.
 */
create or replace function has_role(variadic roles user_role[]) returns boolean
language sql stable as $$
  select coalesce(current_role_name() = any(roles), false);
$$;

alter table profile
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users on delete set null;

comment on column profile.approved_at is
  'Cuándo lo aceptó el jefe de bodega. Null y sin activar = registrado, esperando.';

-- Quien ya estaba adentro antes de que esto existiera no tiene que pedir permiso de nuevo.
update profile set approved_at = created_at where approved_at is null and is_active;

/**
 * El que se registra nace apagado. `is_active` ya se revisa en cada petición, así que una
 * cuenta sin aceptar no llega a ninguna pantalla aunque inicie sesión.
 */
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  insert into profile (id, full_name, employee_code, is_active)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), new.email),
    nullif(trim(new.raw_user_meta_data ->> 'employee_code'), ''),
    false
  );
  return new;
end;
$$;

/**
 * El código que el jefe reparte al contratar. Una sola fila, a propósito.
 *
 * Nace aleatorio: si viniera escrito en la migración quedaría publicado en el repositorio, que
 * es público. El jefe lo ve en su panel y lo cambia cuando quiera.
 */
create table if not exists codigo_registro (
  id boolean primary key default true check (id),
  codigo text not null check (length(trim(codigo)) between 6 and 40),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users on delete set null
);

insert into codigo_registro (id, codigo)
values (true, upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)))
on conflict (id) do nothing;

alter table codigo_registro enable row level security;

drop policy if exists codigo_registro_lee on codigo_registro;
create policy codigo_registro_lee on codigo_registro
  for select to authenticated using (has_role('supervisor', 'admin'));

/** Quién manda sobre el personal. El jefe de bodega entra como supervisión. */
create or replace function manda_sobre_personal() returns boolean
language sql stable security definer set search_path = public as $$
  select has_role('supervisor', 'admin');
$$;

/**
 * Nadie reparte un rol más alto del que tiene: un supervisor no se fabrica administradores.
 * Y `inventarios` quedó muerto en el enum (0025); que no se pueda asignar ni por error.
 */
create or replace function rol_asignable(p_role user_role) returns boolean
language sql stable security definer set search_path = public as $$
  select p_role <> 'inventarios' and (p_role <> 'admin' or has_role('admin'));
$$;

create or replace function aprobar_persona(p_id uuid, p_role user_role) returns profile
language plpgsql security definer set search_path = public as $$
declare
  v profile;
begin
  if not manda_sobre_personal() then
    raise exception 'No tienes permiso para aceptar personal';
  end if;
  if not rol_asignable(p_role) then
    raise exception 'No puedes asignar ese rol';
  end if;

  select * into v from profile where id = p_id for update;
  if not found then
    raise exception 'Esa persona no existe';
  end if;
  if v.approved_at is not null then
    raise exception '% ya estaba aceptada', v.full_name;
  end if;

  update profile
     set role = p_role, is_active = true, approved_at = now(), approved_by = auth.uid()
   where id = p_id
  returning * into v;
  return v;
end;
$$;

/**
 * Rechazar borra la cuenta, y sólo se puede con una que nunca fue aceptada: así la lista de
 * pendientes se limpia de desconocidos sin que exista forma de borrar a alguien que trabajó.
 */
create or replace function rechazar_registro(p_id uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  v profile;
begin
  if not manda_sobre_personal() then
    raise exception 'No tienes permiso para rechazar un registro';
  end if;

  select * into v from profile where id = p_id;
  if not found then
    raise exception 'Esa persona no existe';
  end if;
  if v.approved_at is not null then
    raise exception '% ya fue aceptada: se da de baja, no se borra', v.full_name;
  end if;

  delete from auth.users where id = p_id;
end;
$$;

create or replace function dar_de_baja(p_id uuid) returns profile
language plpgsql security definer set search_path = public as $$
declare
  v profile;
begin
  if not manda_sobre_personal() then
    raise exception 'No tienes permiso para dar de baja';
  end if;
  if p_id = auth.uid() then
    raise exception 'No puedes darte de baja a ti mismo';
  end if;

  select * into v from profile where id = p_id for update;
  if not found then
    raise exception 'Esa persona no existe';
  end if;
  if v.role = 'admin' and not has_role('admin') then
    raise exception 'Sólo un administrador da de baja a otro';
  end if;

  update profile set is_active = false where id = p_id returning * into v;
  return v;
end;
$$;

create or replace function reactivar_persona(p_id uuid) returns profile
language plpgsql security definer set search_path = public as $$
declare
  v profile;
begin
  if not manda_sobre_personal() then
    raise exception 'No tienes permiso para reactivar';
  end if;

  select * into v from profile where id = p_id for update;
  if not found then
    raise exception 'Esa persona no existe';
  end if;
  if v.approved_at is null then
    raise exception '% nunca fue aceptada: acéptala en vez de reactivarla', v.full_name;
  end if;

  update profile set is_active = true where id = p_id returning * into v;
  return v;
end;
$$;

create or replace function cambiar_rol(p_id uuid, p_role user_role) returns profile
language plpgsql security definer set search_path = public as $$
declare
  v profile;
begin
  if not manda_sobre_personal() then
    raise exception 'No tienes permiso para cambiar roles';
  end if;
  if not rol_asignable(p_role) then
    raise exception 'No puedes asignar ese rol';
  end if;
  if p_id = auth.uid() then
    raise exception 'No puedes cambiarte el rol a ti mismo';
  end if;

  select * into v from profile where id = p_id for update;
  if not found then
    raise exception 'Esa persona no existe';
  end if;
  if v.role = 'admin' and not has_role('admin') then
    raise exception 'Sólo un administrador le cambia el rol a otro';
  end if;

  update profile set role = p_role where id = p_id returning * into v;
  return v;
end;
$$;

create or replace function cambiar_codigo_registro(p_codigo text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v text := upper(trim(coalesce(p_codigo, '')));
begin
  if not manda_sobre_personal() then
    raise exception 'No tienes permiso para cambiar el código';
  end if;
  if length(v) < 6 then
    raise exception 'El código necesita al menos 6 caracteres';
  end if;

  update codigo_registro set codigo = v, updated_at = now(), updated_by = auth.uid() where id;
  return v;
end;
$$;

/**
 * Lo que ve el jefe. Va como función y no como vista porque trae el correo, que sale de
 * `auth.users`: una vista se lo enseñaría a cualquiera con sesión.
 */
create or replace function listar_personal()
returns table (
  id uuid,
  full_name text,
  employee_code text,
  email text,
  role user_role,
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
  select p.id, p.full_name, p.employee_code, u.email::text, p.role, p.is_active,
         p.approved_at, p.created_at
  from profile p
  join auth.users u on u.id = p.id
  order by (p.approved_at is null) desc, p.is_active desc, p.full_name;
end;
$$;

grant execute on function aprobar_persona, rechazar_registro, dar_de_baja, reactivar_persona,
  cambiar_rol, cambiar_codigo_registro, listar_personal to authenticated;
