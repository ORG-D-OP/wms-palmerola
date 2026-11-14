/**
 * El ingreso con etiqueta no dejaba contar. Un escaneo de matrícula valía por «bajaron las
 * cajas que dice el papel», y el que recibe no tenía dónde decir que no.
 *
 * Es justo lo que pidió para el andén de recepción: escanear la orden, escanear los pallets,
 * **verificar y corregir las cajas**. En el despacho eso ya existe desde el PR 77 —se escanea,
 * sale la cantidad, y «Corregir la cantidad» la cambia—; en el ingreso el campo sólo estaba en
 * las pantallas sin etiqueta, donde no hay papel con el que comparar.
 *
 * Se resuelve igual que el despacho, y por la misma razón: el escaneo sigue siendo un solo
 * toque, porque el caso normal es que el papel acierte, y la corrección es aparte, a mano, para
 * cuando no. Lo que cambia es que ahora existe.
 *
 * Tres cosas hacen falta. Un motivo con el que apuntarlo, porque un ajuste sin motivo no entra:
 */
insert into reason_code (code, name, description, category, requires_note, is_active)
values (
  'DIFER_RECIBO', 'Diferencia contra el papel al recibir',
  'Lo que bajó del camión no era lo que decía la hoja de la planta.',
  'AJUSTE', false, true
)
on conflict (code) do update
set name = excluded.name, category = excluded.category, is_active = true;

/**
 * Lo que de verdad bajó, apuntado al lado de lo que decía el papel. La cantidad del documento
 * no se toca: el descuadre contra la planta es la diferencia entre las dos, y si se sobreescribe
 * una, mañana no hay con qué reclamar.
 */
alter table inbound_pallet
  add column if not exists received_cases numeric check (received_cases >= 0);

comment on column inbound_pallet.received_cases is
  'Las cajas que se recibieron de verdad. `qty_cases` es lo que decía el papel.';

/**
 * Y recibir apunta, de entrada, que bajaron las del papel: es lo que el escaneo afirma. Así la
 * columna nunca está vacía para un pallet recibido, y la corrección sólo cambia un número que
 * ya existe en vez de inventar el primero.
 */
create or replace function recibir_del_documento(
  p_pedido text,
  p_pallet_code text,
  p_dock_location_id uuid,
  p_barcode text default null,
  p_max_level smallint default null
) returns table (
  lpn_code text,
  to_location_code text,
  sku text,
  product_name text,
  cases numeric,
  recibidos integer,
  pallets integer
)
language plpgsql security definer set search_path = public as $f$
declare
  v_doc inbound_doc;
  v_pal inbound_pallet;
  v_prod product;
  v_case uuid;
  v_base text;
  v_res record;
  v_cuenta record;
begin
  if auth.uid() is null then
    raise exception 'Hace falta una sesion para recibir';
  end if;

  select * into v_doc from inbound_doc
  where ltrim(pedido, '0') = ltrim(trim(p_pedido), '0');
  if not found then
    raise exception 'No hay ningún ingreso con el pedido %', trim(p_pedido);
  end if;

  select * into v_pal from inbound_pallet
  where doc_id = v_doc.id and upper(pallet_code) = upper(trim(p_pallet_code));
  if not found then
    raise exception 'El pallet % no es de este pedido', trim(p_pallet_code);
  end if;
  if v_pal.received_at is not null then
    raise exception 'El pallet % ya se recibió', v_pal.pallet_code;
  end if;

  select * into v_prod from product where id = v_pal.product_id;

  select id into v_case from packaging_level
  where product_id = v_pal.product_id and code = 'CASE';
  if v_case is null then
    raise exception 'A % le falta el corrugado en el maestro: no se puede recibir por cajas',
      v_prod.sku;
  end if;

  if p_barcode is not null and trim(p_barcode) <> '' then
    select p.base_code into v_base
    from barcode b
    join packaging_level pl on pl.id = b.packaging_level_id
    join product p on p.id = pl.product_id
    where b.code = trim(p_barcode)
    limit 1;

    if v_base is null then
      raise exception 'Ese código no está en el maestro';
    end if;
    if v_base is distinct from v_prod.base_code then
      raise exception 'La caja no es de %: el documento dice %', v_base, v_prod.sku;
    end if;
  end if;

  select * into v_res from receive_pallet(
    v_pal.pallet_code, v_pal.product_id, v_case, v_pal.qty_cases, p_dock_location_id,
    v_pal.lot, v_pal.expiry_date, 'doc-' || v_pal.id::text, p_max_level
  );

  update inbound_pallet
  set received_lpn_id = v_res.lpn_id, received_at = now(), received_cases = v_pal.qty_cases
  where id = v_pal.id;

  select count(*)::integer as total, count(received_at)::integer as hechos
  into v_cuenta
  from inbound_pallet where doc_id = v_doc.id;

  update inbound_doc
  set status = case when v_cuenta.hechos >= v_cuenta.total then 'CLOSED' else 'RECEIVING' end
  where id = v_doc.id;

  return query select
    v_res.lpn_code, v_res.to_location_code, v_prod.sku, v_prod.name, v_pal.qty_cases,
    v_cuenta.hechos, v_cuenta.total;
end;
$f$;

/**
 * Y la corrección.
 *
 * Sólo mientras el pallet siga en el andén y **nadie se haya llevado la tarea de guardarlo**.
 * Ésa es la frontera honesta: hasta ahí lo que se corrige es el recibo, y el chequeador lo está
 * viendo; pasada la tarea, el pallet está en una posición y lo que haga falta es un ajuste de
 * inventario, que es otra pantalla y otro permiso.
 *
 * Cero cajas no es una corrección: es que el pallet no bajó. Eso no se arregla con un número,
 * y mientras no exista la pantalla que lo haga, se dice en voz alta en vez de dejar una
 * existencia en cero con una etiqueta viva encima.
 */
create or replace function corregir_recibo(
  p_pedido text,
  p_pallet_code text,
  p_cajas numeric
) returns numeric
language plpgsql security definer set search_path = public as $f$
declare
  v_doc inbound_doc;
  v_pal inbound_pallet;
  v_por_caja numeric;
  v_case uuid;
  v_antes numeric;
  v_ahora numeric;
  v_stock record;
  v_task task;
begin
  if not has_role('chequeador', 'supervisor', 'admin') then
    raise exception 'La cantidad recibida la corrige el que chequea el andén';
  end if;

  if p_cajas is null or p_cajas <= 0 then
    raise exception 'Si no bajó ninguna caja, el pallet no se recibió: avisa al jefe de bodega';
  end if;

  select * into v_doc from inbound_doc
  where ltrim(pedido, '0') = ltrim(trim(p_pedido), '0');
  if not found then
    raise exception 'No hay ningún ingreso con el pedido %', trim(p_pedido);
  end if;

  select * into v_pal from inbound_pallet
  where doc_id = v_doc.id and upper(pallet_code) = upper(trim(p_pallet_code))
  for update;
  if not found then
    raise exception 'El pallet % no es de este pedido', trim(p_pallet_code);
  end if;
  if v_pal.received_at is null then
    raise exception 'El pallet % todavía no se ha recibido', v_pal.pallet_code;
  end if;

  select id, qty_base_units into v_case, v_por_caja from packaging_level
  where product_id = v_pal.product_id and code = 'CASE';

  -- Donde está el pallet ahora. Si no está en un andén, ya se guardó.
  select s.id, s.location_id, s.qty_base, s.qty_allocated, l.code as location_code
  into v_stock
  from stock s
  join location l on l.id = s.location_id
  where s.lpn_id = v_pal.received_lpn_id and s.qty_base > 0
  limit 1;

  if not found then
    raise exception 'De ese pallet ya no queda nada en el sistema';
  end if;
  if not exists (select 1 from dock_door d where 'STG-' || d.code = v_stock.location_code) then
    raise exception 'El pallet % ya está en %: eso se arregla contando la posición',
      v_pal.pallet_code, v_stock.location_code;
  end if;

  select * into v_task from task
  where lpn_id = v_pal.received_lpn_id and type = 'PUTAWAY'
    and status not in ('DONE', 'CANCELLED')
  order by created_at desc
  limit 1;

  if found and v_task.status <> 'READY' then
    raise exception 'Ya se llevaron el pallet % a guardar: la cantidad se arregla contando',
      v_pal.pallet_code;
  end if;

  v_antes := v_stock.qty_base;
  v_ahora := p_cajas * v_por_caja;

  if v_ahora = v_antes then
    return p_cajas;
  end if;
  if v_ahora < v_stock.qty_allocated then
    raise exception 'De ese pallet ya hay % apartadas para un camión',
      trim_scale(v_stock.qty_allocated / v_por_caja);
  end if;

  perform post_movement(
    'ADJUST', v_pal.product_id, abs(v_ahora - v_antes),
    case when v_ahora < v_antes then v_stock.location_id end,
    case when v_ahora > v_antes then v_stock.location_id end,
    v_pal.received_lpn_id, v_pal.lot, v_pal.expiry_date,
    'DIFER_RECIBO',
    'El papel decía ' || trim_scale(v_pal.qty_cases) || ' cajas y bajaron ' ||
      trim_scale(p_cajas),
    v_case, null, null, null
  );

  update inbound_pallet set received_cases = p_cajas where id = v_pal.id;

  -- Y el viaje de guardarlo lleva lo que hay, no lo que decía el papel.
  if v_task.id is not null then
    update task set qty_base = v_ahora where id = v_task.id;
  end if;

  return p_cajas;
end;
$f$;

grant execute on function corregir_recibo to authenticated;
