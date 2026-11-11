/**
 * El registro se cierra a una lista de correos, y el código de bodega se va.
 *
 * El código tenía un agujero de los que no se arreglan con más validación: es un secreto
 * compartido. Lo saben 39 personas, se dice en voz alta en la bodega y con él cualquiera
 * desde cualquier parte puede crear cuentas hasta llenar la tabla. Cambiarlo no sirve de
 * nada porque hay que volver a repartirlo.
 *
 * Ahora manda una lista: supervisión da de alta el correo de cada quien —de Dinant o
 * personal, da igual, muchos son subcontratados— y sólo esos correos pueden registrarse. Al
 * que no está en la lista se le dice que no puede, y ahí se acaba. Deja de haber un secreto
 * que cuidar, y el intento masivo no tiene por dónde entrar.
 *
 * Lo que no cambia: estar en la lista no es estar dentro. La cuenta sigue naciendo apagada
 * y sigue necesitando que el jefe la acepte y le ponga rol. La lista dice quién puede pedir
 * entrar; el jefe dice quién entra.
 */

create table if not exists correo_autorizado (
  email text primary key check (email = lower(btrim(email)) and position('@' in email) > 1),
  nota text check (nota is null or length(btrim(nota)) > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users on delete set null
);

alter table correo_autorizado enable row level security;

/**
 * Nadie lo lee con su propia sesión: el panel pasa por `listar_correos` y el registro pasa
 * por la llave secreta, que es la única que puede leer antes de que haya sesión.
 */

drop function if exists cambiar_codigo_registro(text);
drop table if exists codigo_registro;

/**
 * Varios de un jalón, porque el jefe va a llegar con la lista entera en la mano y no va a
 * teclear veinte veces. Los repetidos no son un error: se ignoran y se sigue.
 */
create or replace function autorizar_correos(p_emails text[], p_nota text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
  v_altas integer := 0;
begin
  if not manda_sobre_personal() then
    raise exception 'No tienes permiso para dar de alta correos';
  end if;

  with limpios as (
    select distinct lower(btrim(e)) as email
    from unnest(coalesce(p_emails, '{}'::text[])) as e
    where position('@' in btrim(e)) > 1 and length(btrim(e)) <= 160
  )
  insert into correo_autorizado (email, nota, created_by)
  select email, v_nota, auth.uid() from limpios
  on conflict (email) do nothing;

  get diagnostics v_altas = row_count;

  if v_altas = 0 then
    raise exception 'Ningún correo nuevo: revisa que estén bien escritos';
  end if;

  return v_altas;
end;
$$;

/**
 * Quitar un correo no toca la cuenta que ya se creó con él: para sacar a alguien que ya
 * entró está `dar_de_baja`. Esto sólo cierra la puerta a un registro que todavía no pasó.
 */
create or replace function quitar_correo(p_email text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v text := lower(btrim(coalesce(p_email, '')));
begin
  if not manda_sobre_personal() then
    raise exception 'No tienes permiso para quitar correos';
  end if;

  delete from correo_autorizado where email = v;
  if not found then
    raise exception 'Ese correo no está en la lista';
  end if;

  return v;
end;
$$;

/** Trae de paso si el correo ya se usó, que es lo que el jefe quiere saber al mirar. */
create or replace function listar_correos()
returns table (email text, nota text, created_at timestamptz, ya_registrado boolean)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not manda_sobre_personal() then
    raise exception 'No tienes permiso para ver la lista de correos';
  end if;

  return query
  select c.email, c.nota, c.created_at,
         exists (select 1 from auth.users u where lower(u.email) = c.email)
  from correo_autorizado c
  order by ya_registrado, c.created_at desc;
end;
$$;

grant execute on function autorizar_correos, quitar_correo, listar_correos to authenticated;

/**
 * La primera persona de la lista es quien ya está dentro: sin esto, un administrador que se
 * creó por script no podría volver a registrarse si perdiera la cuenta, y la bodega
 * arrancaría con la lista vacía y nadie a quien dar de alta.
 */
insert into correo_autorizado (email, nota)
select lower(u.email), 'Ya tenía cuenta antes de la lista'
from auth.users u
where u.email is not null
on conflict (email) do nothing;
