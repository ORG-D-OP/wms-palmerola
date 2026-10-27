-- La matricula ya no la genera el WMS: viene de la etiqueta que el pallet trae al llegar.
-- El operario la escanea y el sistema la adopta.
drop function receive_pallet(uuid, uuid, numeric, uuid, text, date, text);
drop sequence lpn_code_seq;

create function receive_pallet(
  p_lpn_code text,
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
  v_code text := trim(p_lpn_code);
  v_lpn lpn;
  v_previa record;
  v_destino uuid;
  v_task uuid;
  v_product product;
begin
  if auth.uid() is null then
    raise exception 'Hace falta una sesion para recibir';
  end if;

  if length(v_code) < 4 then
    raise exception 'Escanea la etiqueta del pallet';
  end if;

  -- Una matricula repetida casi siempre significa que ese pallet ya se recibio.
  select l.code, loc.code as ubicacion into v_previa
  from lpn l
  left join stock s on s.lpn_id = l.id and s.qty_base > 0
  left join location loc on loc.id = s.location_id
  where l.code = v_code
  limit 1;

  if found then
    raise exception 'El pallet % ya esta en el sistema%', v_code,
      coalesce(', en ' || v_previa.ubicacion, '');
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

  insert into lpn (code, created_by) values (v_code, auth.uid()) returning * into v_lpn;

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

grant execute on function receive_pallet to authenticated;
