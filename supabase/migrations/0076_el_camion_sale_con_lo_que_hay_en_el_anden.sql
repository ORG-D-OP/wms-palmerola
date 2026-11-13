/**
 * El camión surtido de un pallet que no se vació no podía salir **nunca**.
 *
 * Probado a clic el 13 de noviembre: se surten 2 de 4 cajas, el producto queda en el andén, se
 * cierra el camión y la base contesta «Sin existencia suficiente: hay 0.000 y se piden
 * 288.000». Las 288 unidades están ahí, en el andén, a la vista. Dos camiones se quedaron
 * atascados así.
 *
 * Por qué: cuando se surten cajas y **queda algo en el pallet**, lo que sale deja de ser parte
 * de esa estiba, así que la existencia cae en el andén **sin matrícula** (`p_desprende`, de la
 * migración 0022). El movimiento de surtido, en cambio, sí guarda de qué pallet salieron —eso
 * es la trazabilidad y está bien—. Y `despachar()` reconstruía la salida leyendo esos
 * movimientos y pasando la matrícula **tal cual**: pedía descontar del andén una combinación
 * de producto y pallet que en el andén no existe.
 *
 * De ahí que el camión de pallets completos sí saliera y el de cajas sueltas no: con el pallet
 * entero no hay nada que desprender y los dos lados cuadran. Eso explica que no se viera antes:
 * las comprobaciones despachaban los dos casos buenos y ninguno del malo, y en la base de
 * verdad no había salido todavía ni un solo camión.
 *
 * El arreglo es que el movimiento **apunte que se desprendió**, en vez de que despachar lo
 * adivine. Se adivinaba mal de una manera que no se arregla mirando la existencia: si de un
 * mismo pallet se surte primero una parte y después el resto, el andén acaba con dos renglones
 * —uno sin matrícula y otro con ella— y los dos movimientos dicen lo mismo. Con el dato
 * apuntado no hay nada que deducir.
 *
 * Los movimientos de antes de esta columna se quedan en nulo, que aquí significa «no se sabe»,
 * y para ésos sí se deduce de la existencia del andén: es lo único que hay, y basta para los
 * dos camiones atascados. Rellenarlos no se puede ni se debe: el libro mayor no admite UPDATE.
 */
alter table stock_movement add column if not exists detached boolean;

comment on column stock_movement.detached is
  'Si lo que salió se desprendió del pallet y entró al destino sin matrícula. '
  'Nulo en los movimientos anteriores a la columna: ahí se deduce de la existencia.';

create or replace function post_movement(
  p_type movement_type,
  p_product_id uuid,
  p_qty numeric,
  p_from_location_id uuid default null,
  p_to_location_id uuid default null,
  p_lpn_id uuid default null,
  p_lot text default null,
  p_expiry date default null,
  p_reason_code text default null,
  p_note text default null,
  p_packaging_level_id uuid default null,
  p_task_id uuid default null,
  p_device_id text default null,
  p_idempotency_key text default null,
  p_desprende boolean default false
) returns bigint
language plpgsql security definer set search_path = public as $f$
declare
  v_existing bigint;
  v_reason reason_code;
  v_prev text;
  v_hash text;
  v_id bigint;
begin
  if p_idempotency_key is not null then
    select id into v_existing from stock_movement where idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  if p_reason_code is not null then
    select * into v_reason from reason_code where code = p_reason_code and is_active;
    if not found then
      raise exception 'Motivo % no existe o esta inactivo', p_reason_code;
    end if;
    if v_reason.requires_note and coalesce(trim(p_note), '') = '' then
      raise exception 'El motivo % exige una nota', p_reason_code;
    end if;
  elsif p_type = 'ADJUST' then
    raise exception 'Un ajuste siempre lleva motivo';
  end if;

  -- Serializa la cadena de hash. Los movimientos son pocos por segundo, asi que no estorba.
  perform pg_advisory_xact_lock(hashtext('stock_movement_chain'));

  if p_from_location_id is not null then
    perform apply_stock_delta(
      p_from_location_id, p_product_id, p_lpn_id, p_lot, p_expiry, -p_qty
    );
  end if;

  if p_to_location_id is not null then
    perform apply_stock_delta(
      p_to_location_id, p_product_id,
      case when p_desprende then null else p_lpn_id end,
      p_lot, p_expiry, p_qty
    );
  end if;

  select hash into v_prev from stock_movement order by id desc limit 1;

  v_hash := encode(
    sha256(convert_to(
      coalesce(v_prev, '') || p_type::text || p_product_id::text || p_qty::text
        || coalesce(p_from_location_id::text, '') || coalesce(p_to_location_id::text, '')
        || coalesce(p_lot, '') || coalesce(p_expiry::text, '') || coalesce(auth.uid()::text, ''),
      'utf8'
    )),
    'hex'
  );

  insert into stock_movement (
    type, product_id, packaging_level_id, qty_base, from_location_id, to_location_id,
    lpn_id, lot, expiry_date, reason_code, note, task_id, actor_id, device_id,
    idempotency_key, prev_hash, hash, detached
  ) values (
    p_type, p_product_id, p_packaging_level_id, p_qty, p_from_location_id, p_to_location_id,
    p_lpn_id, p_lot, p_expiry, p_reason_code, p_note, p_task_id, auth.uid(), p_device_id,
    p_idempotency_key, v_prev, v_hash, p_desprende
  ) returning id into v_id;

  return v_id;
end;
$f$;

/**
 * Y la salida se arma con la matrícula que de verdad está en el andén.
 *
 * El crossdock no tiene columna que mirar porque no pasa por un movimiento de surtido: ahí va
 * el pallet entero al andén, así que la matrícula es buena. Se le aplica la misma deducción de
 * todas formas, que para el pallet entero da lo mismo y cubre el día que no lo dé.
 *
 * Lo que **no** se hace es descontar «toda la existencia del andén»: ocho andenes se reparten
 * los pedidos y por ahí se iría el producto del camión de al lado.
 */
create or replace function despachar(p_order_id uuid, p_forzar boolean default false, p_nota text default null)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_estado order_status;
  v_pendientes integer;
  v_en_curso integer;
  m record;
  a record;
begin
  if not has_role('chequeador', 'supervisor', 'admin') then
    raise exception 'No tienes permiso para despachar';
  end if;

  select status into v_estado from sales_order where id = p_order_id for update;
  if v_estado is null then raise exception 'Ese camión no existe'; end if;
  if v_estado = 'SHIPPED' then raise exception 'Ese camión ya salió'; end if;
  if v_estado = 'CANCELLED' then raise exception 'Ese camión está anulado'; end if;
  if v_estado = 'DRAFT' then
    raise exception 'Ese camión todavía no se ha abierto a surtido';
  end if;

  select pendientes into v_pendientes from despacho_progreso where id = p_order_id;

  if coalesce(v_pendientes, 0) > 0 and not p_forzar then
    raise exception 'Faltan % tareas de surtido por terminar', v_pendientes;
  end if;

  if falta_del_camion(p_order_id) > 0 and not p_forzar then
    raise exception 'Al camión le faltan % por apartar: reabastece picking o ciérralo con razón',
      trim_scale(falta_del_camion(p_order_id));
  end if;

  if p_forzar then
    if coalesce(trim(p_nota), '') = '' then
      raise exception 'Para cerrar un camión incompleto hace falta decir por qué';
    end if;

    select count(*) into v_en_curso
    from order_line l
    join allocation al on al.order_line_id = l.id
    join task t on t.id = al.task_id
    where l.order_id = p_order_id and t.status = 'IN_PROGRESS';

    if v_en_curso > 0 then
      raise exception 'Alguien anda surtiendo algo de este camión. Espera a que lo deje';
    end if;

    -- Lo apartado y no surtido se suelta: ese producto no se puede quedar reservado para un
    -- camión que ya se fue.
    for a in
      select al.id, al.stock_id, al.qty_base, al.task_id
      from order_line l
      join allocation al on al.order_line_id = l.id
      join task t on t.id = al.task_id
      where l.order_id = p_order_id and t.status in ('READY', 'ASSIGNED', 'BLOCKED')
    loop
      update stock set qty_allocated = greatest(qty_allocated - a.qty_base, 0)
      where id = a.stock_id;
      update task set status = 'CANCELLED' where id = a.task_id;
      delete from allocation where id = a.id;
    end loop;

    update sales_order set ship_note = trim(p_nota) where id = p_order_id;
  end if;

  for m in
    with piezas as (
      select
        'surtido-' || sm.id::text as clave,
        sm.product_id, sm.qty_base, sm.to_location_id, sm.lpn_id, sm.lot,
        sm.expiry_date, sm.packaging_level_id, sm.detached
      from stock_movement sm
      where sm.type = 'PICK'
        and sm.task_id in (
          select a2.task_id
          from order_line l
          join allocation a2 on a2.order_line_id = l.id
          where l.order_id = p_order_id and a2.task_id is not null
        )
      union all
      select
        'xdock-' || c.id::text,
        c.product_id, c.qty_base, c.to_location_id, c.lpn_id, c.lot,
        c.expiry_date, null::uuid, null::boolean
      from order_line l
      join order_crossdock c on c.order_line_id = l.id
      where l.order_id = p_order_id
    )
    select
      p.clave, p.product_id, p.qty_base, p.to_location_id, p.lot, p.expiry_date,
      p.packaging_level_id,
      case
        when coalesce(
          p.detached,
          -- Sin dato apuntado: se desprendió si en el andén no queda nada con esa matrícula.
          not exists (
            select 1 from stock s
            where s.location_id = p.to_location_id
              and s.product_id = p.product_id
              and s.lpn_id is not distinct from p.lpn_id
              and s.lot is not distinct from p.lot
              and s.expiry_date is not distinct from p.expiry_date
              and s.qty_base > 0
          )
        ) then null
        else p.lpn_id
      end as lpn_id
    from piezas p
  loop
    perform post_movement(
      'SHIP', m.product_id, m.qty_base, m.to_location_id, null, m.lpn_id,
      m.lot, m.expiry_date, 'VENTA', null, m.packaging_level_id, null, null,
      'ship-' || m.clave
    );
  end loop;

  update sales_order set status = 'SHIPPED', shipped_at = now() where id = p_order_id;
end;
$fn$;
