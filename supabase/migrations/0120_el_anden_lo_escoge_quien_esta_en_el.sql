/**
 * El andén lo escoge quien está parado en él, y a nadie se le mueve a medio camino.
 *
 * Dos cosas que faltaban, y la segunda es la que importa.
 *
 * **1. Moverse era sólo del jefe.** El andén decide qué tareas le caen a cada quien
 * —`claim_next_task` filtra por él—, pero cambiarlo sólo podía `asignar_anden`, que pide
 * rango de supervisor y recibe a quién se le cambia. Así que el auxiliar que termina en el
 * andén 9 y se va al 12 no tenía cómo decirlo: se quedaba esperando a que el jefe lo moviera,
 * y mientras tanto la cola le seguía dando trabajo del andén que ya dejó.
 *
 * No es un privilegio que haya que pedir: es un dato de dónde está parado. El sistema ya le
 * confía uno igual, con las mismas consecuencias — `cambiar_equipo` no pide rango de jefe, y
 * la máquina decide a qué niveles del rack le caen tareas. El andén es de la misma clase de
 * cosa, así que se declara igual. El jefe no pierde nada: `asignar_anden` sigue siendo suya
 * para colocar gente, y en su reparto ve dónde está cada uno.
 *
 * **2. Se podía mover a alguien a medio camino.** La 0043 lo permitía a propósito: soltaba lo
 * asignado y no empezado —las tareas son del andén, no de la persona, y eso se queda— pero
 * dejaba pasar el cambio con una tarea en curso, avisando «anda a medio camino con algo para
 * X: lo termina y pasa».
 *
 * Eso es lo que se cierra aquí, y es grave que estuviera abierto: quien va con un pallet en
 * las uñas está **físicamente** en el andén viejo. Moverlo deja al sistema diciendo que está
 * en otro sitio mientras la tarea que trae apunta al de antes, y la pantalla lo manda a
 * caminar de un lado a otro de la bodega. Ahora el cambio se niega, lo pida quien lo pida:
 * primero se termina lo empezado.
 *
 * Lo que sigue igual, porque ya estaba bien: al cambiar de andén, **lo asignado y no empezado
 * vuelve a la cola** del andén que deja, libre, para que se lo lleve quien quede ahí.
 */

-- ---------------------------------------------------------------------------
-- El trabajo de verdad, en un solo sitio
-- ---------------------------------------------------------------------------

/**
 * Pone a alguien en un andén, con sus dos reglas.
 *
 * No se concede a nadie: las dos puertas de entrada son `cambiar_anden`, que es de quien se
 * mueve, y `asignar_anden`, que es del jefe. Las dos son `security definer`, así que pueden
 * llamar a esto sin que esté concedido, y así no hay forma de saltarse el filtro de rango
 * llamando directo a la de abajo.
 *
 * `p_propio` sólo escoge cómo se le habla a quien lee el aviso: moverse uno mismo y mover a
 * otro son el mismo movimiento, pero no la misma frase.
 */
create or replace function poner_anden(
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

  -- La guarda nueva. Quien trae un pallet en las uñas está en el andén viejo, y eso no lo
  -- cambia un registro: primero termina lo que lleva.
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

comment on function poner_anden(uuid, text, boolean) is
  'El trabajo de cambiar de andén, con sus dos reglas: lo asignado y sin empezar vuelve a la '
  'cola, y con algo en curso no se mueve. No se concede: se entra por cambiar_anden o por '
  'asignar_anden.';

/**
 * Y no basta con no concederla: Postgres le da `execute` a `public` a toda función nueva, así
 * que sin esta línea cualquiera con sesión podía llamarla por la API y mover a quien quisiera
 * sin pasar por el filtro de rango de `asignar_anden`. Se le quita a `public`; las dos puertas
 * de arriba son `security definer`, así que siguen pudiendo llamarla.
 */
revoke execute on function poner_anden(uuid, text, boolean) from public;

-- ---------------------------------------------------------------------------
-- Quien se mueve lo dice
-- ---------------------------------------------------------------------------

/**
 * Me cambio de andén. Sin andén, «toda la bodega»: te cae trabajo de cualquiera.
 *
 * No pide rango: lo puede quien tenga turno abierto, que es quien está en la bodega. Y no
 * hace falta más control que el de la guarda, porque mover el andén no mueve producto: lo
 * único que cambia es qué cola le da trabajo a esa persona.
 */
create or replace function cambiar_anden(p_anden text default null)
returns table (anden text, liberadas integer)
language plpgsql security definer set search_path = public as $f$
begin
  if auth.uid() is null then
    raise exception 'Hace falta una sesión';
  end if;
  return query select * from poner_anden(auth.uid(), p_anden, true);
end;
$f$;

grant execute on function cambiar_anden to authenticated;

-- ---------------------------------------------------------------------------
-- Y el jefe sigue repartiendo
-- ---------------------------------------------------------------------------

/**
 * El reparto del jefe. Deja de devolver `en_curso`, porque ya no hay nada que avisar: con
 * algo empezado el cambio no pasa, y el aviso llega como lo que es, un error con el sitio
 * donde está esa tarea.
 */
drop function if exists asignar_anden(uuid, text);

create function asignar_anden(p_profile_id uuid, p_anden text default null)
returns table (anden text, liberadas integer)
language plpgsql security definer set search_path = public as $f$
begin
  if not has_role('supervisor', 'admin') then
    raise exception 'Sólo el jefe de bodega reparte la gente entre andenes';
  end if;
  return query select * from poner_anden(p_profile_id, p_anden, false);
end;
$f$;

grant execute on function asignar_anden to authenticated;
