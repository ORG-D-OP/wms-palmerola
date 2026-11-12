-- ---------------------------------------------------------------------------------------
-- Reordenar: dos escaneos y nada mas
-- ---------------------------------------------------------------------------------------
--
-- «Los ordenamientos solo se necesita escanear el lugar actual y el lugar al que va, porque
-- el sistema ya sabe que producto hay y hace la transferencia.» Asi que no se teclea producto
-- ni cantidad ni lote: todo sale de la existencia.
--
-- La matricula de pallet entra cuando hace falta distinguir: una posicion de piso puede tener
-- varios pallets apilados, y entonces el lugar no dice cual se mueve. Tambien sirve de primer
-- escaneo por si misma —la matricula ya dice donde esta el pallet—, que es un escaneo menos.

/**
 * Lo que hay en una posicion o en un pallet, tal como lo va a ver quien escanea. Una fila por
 * pallet, mas una de lo suelto si hay cajas sin pallet.
 */
create or replace function hay_en(p_texto text)
returns table (
  stock_id uuid,
  location_id uuid,
  location_code text,
  lpn_id uuid,
  lpn_code text,
  product_id uuid,
  sku text,
  nombre text,
  lot text,
  expiry_date date,
  qty_base numeric,
  qty_allocated numeric
)
language sql stable security definer set search_path = public as $$
  select
    s.id, s.location_id, l.code, s.lpn_id, lp.code, s.product_id, p.sku, p.name,
    s.lot, s.expiry_date, s.qty_base, s.qty_allocated
  from stock s
  join location l on l.id = s.location_id
  join product p on p.id = s.product_id
  left join lpn lp on lp.id = s.lpn_id
  where s.qty_base > 0
    and (l.code = upper(trim(p_texto)) or lp.code = upper(trim(p_texto)))
  order by lp.code nulls last;
$$;

grant execute on function hay_en to authenticated;

/**
 * La posicion a donde se puede dejar producto. Las mismas comprobaciones que ya hacia guardar,
 * en un solo lugar para que el reordenamiento no tenga su propia lista.
 */
create or replace function destino_valido(p_codigo text, p_task_id uuid default null)
returns location
language plpgsql stable security definer set search_path = public as $$
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
  if not exists (
    select 1 from location_usage u
    where u.code = v_dest.usage_code and u.holds_product and u.is_active
  ) then
    raise exception 'En % no va producto', v_dest.code;
  end if;
  if v_dest.reserved_by_task_id is not null
    and (p_task_id is null or v_dest.reserved_by_task_id <> p_task_id) then
    raise exception 'La posición % está apartada para otra tarea', v_dest.code;
  end if;
  return v_dest;
end;
$$;

grant execute on function destino_valido to authenticated;

/**
 * Mueve de una posicion a otra lo que haya, sin teclear nada.
 *
 * `p_origen` es la posicion o la matricula del pallet. Si la posicion tiene mas de una cosa y
 * no viene matricula se rechaza nombrando lo que hay: el que escanea decide cual.
 *
 * Lo apartado para un pedido no se mueve, y no es un capricho de la base: la tarea de surtido
 * apunta a la posicion, y moverlo por debajo dejaria a quien va a surtir mirando un hueco.
 */
create or replace function reordenar(
  p_origen text,
  p_destino text,
  p_pallet text default null
) returns table (pallet text, sku text, nombre text, cantidad numeric, de text, a text)
language plpgsql security definer set search_path = public as $$
declare
  v_origen text := upper(trim(coalesce(p_origen, '')));
  v_pallet text := nullif(upper(trim(coalesce(p_pallet, ''))), '');
  v_dest location;
  v_cuantos integer;
  v_lista text;
  s record;
begin
  if v_origen = '' or coalesce(trim(p_destino), '') = '' then
    raise exception 'Escanea el lugar de donde sale y el lugar a donde va';
  end if;

  v_dest := destino_valido(p_destino);

  select count(*), string_agg(coalesce(h.lpn_code, 'suelto') || ' (' || h.sku || ')', ', ')
    into v_cuantos, v_lista
  from hay_en(v_origen) h
  where v_pallet is null or h.lpn_code = v_pallet;

  if v_cuantos = 0 then
    if v_pallet is not null then
      raise exception 'El pallet % no está en %', v_pallet, v_origen;
    end if;
    raise exception 'En % no hay nada que mover', v_origen;
  end if;

  if v_cuantos > 1 then
    raise exception
      'En % hay % cosas: %. Escanea la matrícula del pallet que vas a mover',
      v_origen, v_cuantos, v_lista;
  end if;

  select * into s
  from hay_en(v_origen) h
  where v_pallet is null or h.lpn_code = v_pallet;

  if s.location_id = v_dest.id then
    raise exception 'Ya está en %', v_dest.code;
  end if;
  if s.qty_allocated > 0 then
    raise exception
      'Eso está apartado para un pedido: termina el surtido o suéltalo antes de moverlo';
  end if;

  if exists (
    select 1 from stock st
    join location l on l.id = st.location_id
    where l.lane_id = v_dest.lane_id and st.qty_base > 0
      and (st.product_id <> s.product_id or st.lot is distinct from s.lot)
  ) then
    raise exception 'En ese carril hay otro producto o lote. Busca otro hueco';
  end if;

  if s.lpn_id is not null and pallets_que_caben(v_dest.id, s.product_id) <= 0 then
    raise exception 'En % no cabe otro pallet de ese producto', v_dest.code;
  end if;

  perform post_movement(
    'MOVE', s.product_id, s.qty_base, s.location_id, v_dest.id, s.lpn_id, s.lot,
    s.expiry_date, 'TRASLADO'
  );

  return query
  select coalesce(s.lpn_code, 'suelto'), s.sku, s.nombre, s.qty_base, s.location_code,
         v_dest.code;
end;
$$;

grant execute on function reordenar to authenticated;
