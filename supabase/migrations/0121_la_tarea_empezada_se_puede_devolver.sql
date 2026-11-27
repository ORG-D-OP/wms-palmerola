/**
 * La tarea empezada se puede devolver a la cola de su andén.
 *
 * De todas las formas de cerrar una tarea, ninguna pasaba un `IN_PROGRESS` de vuelta a
 * `READY`: lo empezado se completa, y punto. Para el guardado la 0119 abrió la salida de
 * cerrarlo sin hacerlo, pero un **surtido empezado no tenía ninguna** — o se completaba, o se
 * quedaba ahí.
 *
 * Hasta la 0120 eso era sólo un nudo. Desde la 0120 **ancla a la persona a su andén**, porque
 * con algo en curso el cambio de andén se niega. Así que quien empezó una tarea que no puede
 * terminar —el pallet no está donde dice, o se equivocó al escanear— se quedaba atrapado ahí.
 * Era justo lo que la 0120 no debía provocar.
 *
 * Devolver no es cancelar. La tarea sigue valiendo: sigue teniendo su pallet, su destino y su
 * hueco apartado, y el surtido sigue con su existencia reservada. Lo único que se deshace es
 * de quién es. Vuelve libre a la cola de su andén y se la lleva el siguiente que pida trabajo
 * ahí, que es lo que significa que las tareas son del andén y no de las personas.
 *
 * Lo hace el jefe de bodega y no quien la trae, a propósito: devolver lo que uno empezó es
 * soltar el trabajo difícil, y el que está delante del problema puede decirlo sin tener que
 * poder hacerlo él. Con la razón escrita, que es la que explica por qué esa tarea dio dos
 * vueltas.
 */

create table if not exists tarea_devuelta (
  id bigint generated always as identity primary key,
  task_id uuid not null references task on delete cascade,
  -- A quién se le quitó y quién la quitó. Los dos hacen falta: una tarea que vuelve tres
  -- veces de la misma persona y una que vuelve de tres personas distintas no son el mismo
  -- problema.
  de_quien uuid references auth.users on delete set null,
  por_quien uuid references auth.users on delete set null,
  razon text not null check (length(trim(razon)) between 4 and 200),
  occurred_at timestamptz not null default now()
);

create index if not exists tarea_devuelta_task_idx on tarea_devuelta (task_id);

comment on table tarea_devuelta is
  'Cada vez que una tarea empezada volvió a la cola, y por qué. No es la cancelación de la '
  'tarea: la tarea sigue viva y la hace otro.';

alter table tarea_devuelta enable row level security;

drop policy if exists tarea_devuelta_lectura on tarea_devuelta;
create policy tarea_devuelta_lectura on tarea_devuelta
  for select to authenticated using (true);

grant select on tarea_devuelta to authenticated;

/**
 * Devuelve a la cola una tarea que alguien empezó y no va a terminar.
 *
 * Sólo `IN_PROGRESS`: lo que está asignado y sin empezar ya vuelve solo —al cambiar de andén,
 * de rol, de equipo o al salir de trabajo—, así que pedir esto para eso sería dar dos caminos
 * a lo mismo. Si llega una asignada, se dice dónde está la otra puerta.
 *
 * No se toca la existencia: ni el hueco apartado del guardado ni lo reservado del surtido. La
 * tarea es la misma y la va a hacer otro; lo único que cambia es que ya no tiene dueño.
 */
create or replace function devolver_tarea(p_task_id uuid, p_razon text)
returns void
language plpgsql security definer set search_path = public as $f$
declare
  v_task task;
  v_razon text := nullif(trim(coalesce(p_razon, '')), '');
begin
  if not has_role('supervisor', 'admin') then
    raise exception 'Devolver a la cola una tarea empezada es cosa del jefe de bodega';
  end if;

  select * into v_task from task where id = p_task_id for update;
  if not found then
    raise exception 'La tarea no existe';
  end if;

  if v_task.status = 'ASSIGNED' then
    raise exception
      'Esa tarea no se ha empezado: se suelta sola al cambiarle el andén o al salir de trabajo';
  end if;
  if v_task.status <> 'IN_PROGRESS' then
    raise exception 'Esa tarea está %: ya no la trae nadie', v_task.status;
  end if;
  if v_razon is null then
    raise exception 'Escribe por qué vuelve a la cola';
  end if;

  insert into tarea_devuelta (task_id, de_quien, por_quien, razon)
  values (p_task_id, v_task.assigned_to, auth.uid(), v_razon);

  update task
  set status = 'READY', assigned_to = null, assigned_at = null, started_at = null
  where id = p_task_id;
end;
$f$;

grant execute on function devolver_tarea to authenticated;

/**
 * Y para que el jefe pueda hacerlo tiene que verlo: quién anda con algo empezado, qué es y
 * dónde está.
 *
 * Va como vista y no como columna de `disponibles` porque es una fila por tarea y no por
 * persona: alguien puede traer más de una cosa empezada, y el jefe tiene que poder devolver la
 * que está trabada sin tocar la otra.
 */
create or replace view trabajo_empezado as
  select
    t.id as task_id,
    t.type,
    t.assigned_to as profile_id,
    p.full_name,
    pr.sku,
    pr.name as producto,
    lp.code as matricula,
    coalesce(d.code, o.code) as lugar,
    t.started_at,
    (select count(*)::integer from tarea_devuelta td where td.task_id = t.id) as vueltas
  from task t
  join profile p on p.id = t.assigned_to
  left join product pr on pr.id = t.product_id
  left join lpn lp on lp.id = t.lpn_id
  left join location d on d.id = t.to_location_id
  left join location o on o.id = t.from_location_id
  where t.status = 'IN_PROGRESS';

grant select on trabajo_empezado to authenticated;
