create sequence lpn_code_seq start 1;

-- Una posicion de recepcion por puerta de anden: es donde queda el pallet al bajarlo
-- del camion, antes de que el sistema diga a donde guardarlo.
insert into lane (zone_id, code, depth)
select z.id, 'STG-' || d.code, 1
from dock_door d
join zone z on z.code = 'PREP-N' and z.site_id = d.site_id
where d.direction = 'inbound';

insert into location (lane_id, code, barcode, kind)
select l.id, l.code, l.code, 'staging'
from lane l
join zone z on z.id = l.zone_id
where z.code = 'PREP-N' and l.code like 'STG-%';

/**
 * Sugiere donde guardar un pallet. Hoy aplica solo los filtros que ya conocemos;
 * el puntaje completo (ABC, contaminacion, afinidad) entra despues sin tocar a
 * quien la llama, porque la firma no cambia.
 */
create function suggest_putaway_location(
  p_product_id uuid,
  p_lot text default null,
  p_expiry date default null
) returns uuid
language sql stable security definer set search_path = public as $$
  select l.id
  from location l
  join lane la on la.id = l.lane_id
  join zone z on z.id = la.zone_id
  left join stock s on s.location_id = l.id and s.qty_base > 0
  where l.retired_at is null
    and l.status = 'available'
    and l.reserved_by_task_id is null
    and z.kind in ('rack', 'floor')
    and not exists (
      -- Homogeneidad de carril: no se mezcla otro producto o lote en el mismo carril.
      select 1 from stock otro
      join location ol on ol.id = otro.location_id
      where ol.lane_id = l.lane_id and otro.qty_base > 0
        and (otro.product_id <> p_product_id or otro.lot is distinct from p_lot)
    )
  order by
    -- Primero completar un carril que ya tiene el mismo producto y lote.
    (s.product_id is not null) desc,
    l.level,
    l.pick_sequence nulls last,
    l.code
  limit 1;
$$;

/**
 * Recibe un pallet: crea la matricula, asienta la entrada en la posicion de anden
 * y deja la tarea de guardado con su destino apartado. Todo en una transaccion.
 */
create function receive_pallet(
  p_product_id uuid,
  p_packaging_level_id uuid,
  p_qty numeric,
  p_dock_location_id uuid,
  p_lot text default null,
  p_expiry date default null,
  p_idempotency_key text default null
) returns table (lpn_id uuid, lpn_code text, task_id uuid, to_location_id uuid, to_location_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_lpn lpn;
  v_destino uuid;
  v_task uuid;
  v_product product;
begin
  if auth.uid() is null then
    raise exception 'Hace falta una sesion para recibir';
  end if;

  select * into v_product from product where id = p_product_id;
  if not found then
    raise exception 'El producto no existe';
  end if;
  if v_product.status <> 'active' then
    raise exception 'El producto esta % y no se puede recibir', v_product.status;
  end if;

  if v_product.requires_fefo and p_expiry is null then
    raise exception 'Este producto exige fecha de vencimiento';
  end if;

  insert into lpn (code, created_by)
  values ('LPN' || lpad(nextval('lpn_code_seq')::text, 10, '0'), auth.uid())
  returning * into v_lpn;

  perform post_movement(
    'RECEIPT', p_product_id, p_qty, null, p_dock_location_id, v_lpn.id,
    p_lot, p_expiry, null, null, p_packaging_level_id, null, null, p_idempotency_key
  );

  v_destino := suggest_putaway_location(p_product_id, p_lot, p_expiry);

  insert into task (
    type, product_id, qty_base, packaging_level_id, lpn_id, lot, expiry_date,
    from_location_id, to_location_id, zone_id, priority
  )
  select
    'PUTAWAY', p_product_id, p_qty, p_packaging_level_id, v_lpn.id, p_lot, p_expiry,
    p_dock_location_id, v_destino, la.zone_id, 100
  from location l join lane la on la.id = l.lane_id
  where l.id = coalesce(v_destino, p_dock_location_id)
  returning id into v_task;

  if v_destino is not null then
    update location
    set reserved_by_task_id = v_task, reserved_until = now() + interval '2 hours'
    where id = v_destino;
  end if;

  return query
  select v_lpn.id, v_lpn.code, v_task, v_destino, l.code
  from location l where l.id = v_destino;
end;
$$;


grant execute on function suggest_putaway_location, receive_pallet to authenticated;
grant usage, select on sequence lpn_code_seq to authenticated;
