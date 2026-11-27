/**
 * El andén no es un hueco, y una tarea de guardar se puede cerrar.
 *
 * Tres agujeros que salieron de probar el sistema con el crossdock ya quitado. Los dos
 * primeros venían de antes; el tercero lo dejó la 0118 al llevarse la función.
 *
 * **1. Un pallet recibido se podía guardar en un andén de despacho.** `complete_putaway`
 * comprobaba la posición de seis formas —que exista, que no esté retirada, que esté
 * disponible, que no esté apartada para otra tarea, el grupo de contaminación y el carril—
 * pero **no comprobaba el área**, y el filtro `a.code = 'ALMACEN'` vive sólo en la
 * *sugerencia*. Así que en «Escanea la posición donde lo dejaste» se escribía `STG-AND-01` y
 * la tarea cerraba contenta. Y desde el andén el producto deja de existir para el sistema:
 * `apartar_linea` no lo ve —mira sólo `ALMACEN` y `PICKING`— y `area_occupancy` tampoco lo
 * cuenta, porque las 24 posiciones de andén son las únicas de la bodega sin área. Lo mismo
 * por `reordenar`, que valida el destino con `destino_valido`.
 *
 * Es justo el movimiento que hacía el crossdock, y ahora pasaba **sin registro**: la vieja
 * `crossdock()` lo apuntaba, lo contaba en el cumplimiento del pedido y exigía que un camión
 * de verdad pidiera ese producto y esa cantidad. Si el producto entra y se guarda, el andén
 * no puede ser el sitio donde se guarda.
 *
 * **2. No había forma de cerrar una tarea de guardar.** De todas las funciones que cancelan
 * tareas, la única que tocaba una `PUTAWAY` era `crossdock()`; las demás trabajan sobre el
 * surtido. Así que una tarea imposible de cumplir —un químico recibido cuando no queda un
 * solo hueco de su grupo— se quedaba en la cola para siempre: no se podía cancelar, y
 * soltarla sólo la devolvía a la cola.
 *
 * **3. Una tarea que nacía sin destino no lo recuperaba nunca.** Cuando al recibir no hay
 * hueco, la tarea nace con `to_location_id` en null. El motor se llama sólo al recibir, así
 * que al liberarse un hueco la tarea seguía en null y a la persona no se le enseñaba nada:
 * ni mapa, ni cara del rack, ni candidatos. Tenía que adivinar.
 */

-- ---------------------------------------------------------------------------
-- 1. El andén no es un hueco
-- ---------------------------------------------------------------------------

/**
 * Si en esa posición se guarda inventario, o es de paso.
 *
 * La pregunta se contesta por el área y no por el tipo de posición, porque el área es lo que
 * el jefe de bodega mueve: las posiciones de almacén y de picking tienen la suya, y las 24 de
 * andén son las únicas que no tienen ninguna. Lo que no está en un área no lo cuenta nadie
 * —ni el surtido, ni la ocupación—, así que tampoco puede ser el final de un guardado.
 */
create or replace function es_de_almacenaje(p_location_id uuid) returns boolean
language sql stable security definer set search_path = public as $f$
  select exists (
    select 1
    from location_area la
    join area a on a.id = la.area_id
    where la.location_id = p_location_id and la.valid_to is null and a.is_active
  );
$f$;

comment on function es_de_almacenaje(uuid) is
  'Si la posición pertenece a un área activa, que es donde se guarda inventario. Los andenes '
  'no: son de paso, y lo que se queda ahí no lo cuenta el surtido ni la ocupación.';

grant execute on function es_de_almacenaje to authenticated;

create or replace function complete_putaway(p_task_id uuid, p_location_code text)
returns table(location_code text, era_la_sugerida boolean)
language plpgsql security definer set search_path = public as $f$
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

  select * into v_dest from location where code = upper(trim(p_location_code));

  if not found then
    raise exception 'No existe la posición %', p_location_code;
  end if;
  if v_dest.retired_at is not null or v_dest.status <> 'available' then
    raise exception 'La posición % no está disponible', v_dest.code;
  end if;

  -- Faltaban las dos de abajo. La primera es el agujero: el andén pasaba todas las demás.
  if not es_de_almacenaje(v_dest.id) then
    raise exception
      'En % no se guarda: es de paso y lo que se queda ahí no lo cuenta nadie. Llévalo a un hueco del almacén',
      v_dest.code;
  end if;
  if not exists (
    select 1 from location_usage u
    where u.code = v_dest.usage_code and u.holds_product and u.is_active
  ) then
    raise exception 'En % no va producto', v_dest.code;
  end if;

  if v_dest.reserved_by_task_id is not null and v_dest.reserved_by_task_id <> p_task_id then
    raise exception 'La posición % está apartada para otra tarea', v_dest.code;
  end if;

  if (select bool_or(segrega_no_alimento) from site)
     and v_dest.grupo is not null
     and v_dest.grupo <> grupo_del_producto(v_task.product_id)
  then
    if v_dest.grupo = 'NO_ALIMENTO' then
      raise exception 'Ahí sólo va lo que no es alimento. Busca otro hueco';
    end if;
    raise exception 'Eso no es alimento y ahí sí. Llévalo a su zona';
  end if;

  if exists (
    select 1 from stock s join location l on l.id = s.location_id
    where l.carril = v_dest.carril and s.qty_base > 0
      and (s.product_id <> v_task.product_id or s.lot is distinct from v_task.lot)
  ) then
    if v_dest.kind in ('rack_single', 'rack_double_deep') then
      raise exception
        'El frente y el fondo de esa bahía van juntos, y ahí hay otro producto o lote. Busca otro hueco';
    end if;
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
$f$;

grant execute on function complete_putaway(uuid, text) to authenticated;

/**
 * Y lo mismo por el otro camino. `reordenar` valida el destino con esto, así que el andén
 * tampoco es un sitio a donde mover producto a mano.
 *
 * Sacarlo del andén sigue estando permitido: aquí se mira a dónde va, no de dónde sale.
 */
create or replace function destino_valido(p_codigo text)
returns location
language plpgsql stable security definer set search_path = public as $f$
declare
  v_dest location;
begin
  select * into v_dest from location where code = upper(trim(coalesce(p_codigo, '')));
  if not found then
    raise exception 'No existe la posición %', p_codigo;
  end if;
  if v_dest.retired_at is not null or v_dest.status <> 'available' then
    raise exception 'La posición % no está disponible', v_dest.code;
  end if;
  if not es_de_almacenaje(v_dest.id) then
    raise exception
      'En % no se guarda: es de paso y lo que se queda ahí no lo cuenta nadie', v_dest.code;
  end if;
  if not exists (
    select 1 from location_usage u
    where u.code = v_dest.usage_code and u.holds_product and u.is_active
  ) then
    raise exception 'En % no va producto', v_dest.code;
  end if;
  if v_dest.reserved_by_task_id is not null then
    raise exception 'La posición % está apartada para otra tarea', v_dest.code;
  end if;
  return v_dest;
end;
$f$;

grant execute on function destino_valido(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Buscar hueco otra vez
-- ---------------------------------------------------------------------------

/**
 * Vuelve a preguntarle al motor dónde va este pallet, y aparta el hueco.
 *
 * Es la salida de la tarea que nació sin destino: cuando al recibir no había hueco, nadie
 * volvía a mirar. Sirve igual para la que lo tiene y ya no vale —porque el hueco se llenó
 * por otro lado— y no le quita el trabajo a nadie: el pallet, el lote y el vencimiento son
 * los de la tarea.
 *
 * El alcance es el de la máquina de quien pregunta, igual que en el resto del sistema: no
 * tiene sentido mandar al de piso a un nivel al que no llega.
 *
 * Si sigue sin haber hueco, se levanta excepción y la tarea se queda como estaba. Devolver
 * null dejaría a la pantalla diciendo «listo» sin haber cambiado nada.
 */
create or replace function buscar_hueco_otra_vez(p_task_id uuid)
returns table (code text, era_la_misma boolean)
language plpgsql security definer set search_path = public as $f$
declare
  v_task task;
  v_antes uuid;
  v_destino uuid;
begin
  if not has_role('auxiliar', 'chequeador', 'montacargista', 'supervisor', 'admin') then
    raise exception 'No tienes permiso para mover inventario';
  end if;

  select * into v_task from task where id = p_task_id for update;
  if not found then
    raise exception 'La tarea no existe';
  end if;
  if v_task.type <> 'PUTAWAY' then
    raise exception 'Eso no es una tarea de guardar';
  end if;
  if v_task.status in ('DONE', 'CANCELLED') then
    raise exception 'Esa tarea ya está %', v_task.status;
  end if;

  v_antes := v_task.to_location_id;

  v_destino := suggest_putaway_location(
    v_task.product_id, v_task.lot, v_task.expiry_date, alcance_de(auth.uid())
  );

  if v_destino is null then
    raise exception
      'Sigue sin haber hueco libre para ese producto. Avisa al jefe de bodega: él puede cerrar la tarea y dejar el pallet donde está';
  end if;

  update location set reserved_by_task_id = null, reserved_until = null
  where reserved_by_task_id = p_task_id;

  update location
  set reserved_by_task_id = p_task_id, reserved_until = now() + interval '2 hours'
  where id = v_destino;

  -- El nivel y la zona van con el destino, igual que al crear la tarea: el nivel es el
  -- portón del alcance en la cola, y la zona es por donde se filtra el trabajo.
  update task t
  set to_location_id = v_destino,
      min_level = coalesce(l.level, 0),
      zone_id = la.zone_id
  from location l join lane la on la.id = l.lane_id
  where t.id = p_task_id and l.id = v_destino;

  -- `is not distinct from` y no `=`: cuando la tarea nació sin destino, `v_antes` es null y
  -- la comparación daría null, que en la pantalla se lee como «no sé».
  return query
  select l.code, v_destino is not distinct from v_antes
  from location l where l.id = v_destino;
end;
$f$;

grant execute on function buscar_hueco_otra_vez to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Cerrar una tarea de guardar que no se puede cumplir
-- ---------------------------------------------------------------------------

/**
 * El jefe de bodega cierra el guardado y el pallet se queda donde está.
 *
 * Hace falta para el caso que no tiene otra salida: un químico que entra cuando no queda un
 * solo hueco de su grupo. La tarea no se puede cumplir —guardarlo donde hay alimento se
 * niega, y con razón— y hasta ahora tampoco se podía cerrar.
 *
 * El pallet **no se mueve ni se borra**: se queda en el andén, con su saldo, y se ve en
 * inventario. Lo que se cierra es el viaje. Cuando haya hueco se saca con `reordenar`, que
 * es la misma puerta por la que se mueve cualquier otra cosa.
 *
 * Pide razón, como despachar corto y como el recuento que no cuadra: una tarea cancelada sin
 * explicación es una pregunta para el día siguiente.
 */
create or replace function cancelar_guardado(p_task_id uuid, p_razon text)
returns void
language plpgsql security definer set search_path = public as $f$
declare
  v_task task;
  v_razon text := nullif(trim(coalesce(p_razon, '')), '');
begin
  if not has_role('supervisor', 'admin') then
    raise exception 'Cerrar un guardado sin hacerlo es cosa del jefe de bodega';
  end if;

  select * into v_task from task where id = p_task_id for update;
  if not found then
    raise exception 'La tarea no existe';
  end if;
  if v_task.type <> 'PUTAWAY' then
    raise exception 'Eso no es una tarea de guardar';
  end if;
  if v_task.status = 'DONE' then
    raise exception 'Ese pallet ya se guardó';
  end if;
  if v_task.status = 'CANCELLED' then
    raise exception 'Esa tarea ya está cancelada';
  end if;
  if v_razon is null then
    raise exception 'Escribe por qué este pallet no se va a guardar';
  end if;

  update task
  set status = 'CANCELLED', completed_at = now(), closed_reason = v_razon
  where id = p_task_id;

  update location set reserved_by_task_id = null, reserved_until = null
  where reserved_by_task_id = p_task_id;
end;
$f$;

grant execute on function cancelar_guardado to authenticated;
