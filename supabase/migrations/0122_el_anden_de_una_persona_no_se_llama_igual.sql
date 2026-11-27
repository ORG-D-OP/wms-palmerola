/**
 * El andén de una persona no se llama igual que el de un camión.
 *
 * La 0120 metió `poner_anden(profile_id, anden, propio)` para parar a alguien en un andén, y
 * ya había una `poner_anden(order_id, anden)` desde la 0091 que le pone el andén de carga a un
 * camión. Dos cosas que no tienen nada que ver con el mismo nombre.
 *
 * No choca al llamarlas —les cambia el número de parámetros— y por eso pasó sin que nadie se
 * quejara. Lo que sí hace es dejar el nombre sin significado: en los tipos generados aparece
 * como dos cosas distintas con un `|` en medio, y quien lea `poner_anden` en un diff no puede
 * saber de cuál se habla sin contar argumentos.
 *
 * La de la persona pasa a llamarse `parar_en_anden`, que es como se dice en la bodega —«dónde
 * está parada cada persona»— y no se confunde con la del camión. Mismo cuerpo, mismas reglas:
 * lo asignado y sin empezar vuelve a la cola, y con algo en curso no se mueve nadie.
 */

drop function if exists poner_anden(uuid, text, boolean);

create or replace function parar_en_anden(
  p_profile_id uuid,
  p_anden text,
  p_propio boolean
)
returns table (anden text, liberadas integer)
language plpgsql security definer set search_path = public as $f$
declare
  v_anden uuid;
  v_codigo text;
  v_turno shift_assignment;
  v_curso text;
  v_liberadas integer;
begin
  if nullif(trim(coalesce(p_anden, '')), '') is not null then
    select id, code into v_anden, v_codigo
    from dock_door where code = upper(trim(p_anden)) and is_active;
    if v_anden is null then
      raise exception 'No hay ningún andén activo con el código %', upper(trim(p_anden));
    end if;
  end if;

  select * into v_turno
  from shift_assignment
  where profile_id = p_profile_id and ended_at is null
  for update;

  if not found then
    if p_propio then
      raise exception 'Primero entra a trabajar';
    end if;
    raise exception 'Esa persona no está trabajando ahora mismo';
  end if;

  if v_turno.dock_door_id is not distinct from v_anden then
    if p_propio then
      raise exception 'Ya andas ahí';
    end if;
    raise exception 'Esa persona ya está ahí';
  end if;

  -- Quien trae un pallet en las uñas está en el andén viejo, y eso no lo cambia un registro:
  -- primero termina lo que lleva. Si no puede, el jefe se lo devuelve a la cola (0121).
  select coalesce(l.code, 'otra tarea') into v_curso
  from task t
  left join location l on l.id = coalesce(t.to_location_id, t.from_location_id)
  where t.assigned_to = p_profile_id and t.status = 'IN_PROGRESS'
  limit 1;

  if v_curso is not null then
    if p_propio then
      raise exception
        'Tienes algo empezado para %: termínalo y después te cambias de andén', v_curso;
    end if;
    raise exception
      'Anda a medio camino con algo para %: no se le puede mover hasta que lo termine',
      v_curso;
  end if;

  -- Lo asignado y no empezado vuelve a la cola, libre. El orden importa: primero se suelta lo
  -- del andén viejo, después se cambia el andén.
  with sueltas as (
    update task
    set status = 'READY', assigned_to = null, assigned_at = null
    where assigned_to = p_profile_id and status = 'ASSIGNED'
    returning 1
  )
  select count(*)::integer into v_liberadas from sueltas;

  update shift_assignment set dock_door_id = v_anden where id = v_turno.id;

  return query select v_codigo, v_liberadas;
end;
$f$;

comment on function parar_en_anden(uuid, text, boolean) is
  'Para a una persona en un andén, con sus dos reglas: lo asignado y sin empezar vuelve a la '
  'cola, y con algo en curso no se mueve. No se concede: se entra por cambiar_anden o por '
  'asignar_anden. No confundir con poner_anden, que es el andén de carga de un camión.';

-- Postgres le da `execute` a `public` a toda función nueva, y esta no mira el rango —lo miran
-- las dos puertas de arriba—, así que sin esto se podría mover a quien fuera por la API.
revoke execute on function parar_en_anden(uuid, text, boolean) from public;

create or replace function cambiar_anden(p_anden text default null)
returns table (anden text, liberadas integer)
language plpgsql security definer set search_path = public as $f$
begin
  if auth.uid() is null then
    raise exception 'Hace falta una sesión';
  end if;
  return query select * from parar_en_anden(auth.uid(), p_anden, true);
end;
$f$;

grant execute on function cambiar_anden to authenticated;

create or replace function asignar_anden(p_profile_id uuid, p_anden text default null)
returns table (anden text, liberadas integer)
language plpgsql security definer set search_path = public as $f$
begin
  if not has_role('supervisor', 'admin') then
    raise exception 'Sólo el jefe de bodega reparte la gente entre andenes';
  end if;
  return query select * from parar_en_anden(p_profile_id, p_anden, false);
end;
$f$;

grant execute on function asignar_anden to authenticated;
