/**
 * Dos arreglos del ingreso sin aviso, encontrados probándolo.
 *
 * 1. La pantalla no sabía que el ingreso era a ciegas. El dato estaba bien en la tabla pero
 *    la vista que la pantalla consulta no lo traía, así que había que ir a buscarlo en una
 *    segunda consulta —y una consulta de más es una forma de fallar de más—. Ahora viene en
 *    la misma vista.
 *
 * 2. Recibir a ciegas exige lote y vencimiento. Cuando hay documento esos datos vienen de
 *    planta y se confían; aquí los pone quien está descargando, y son justamente los dos
 *    que nadie puede reconstruir después. Sin ellos no hay FEFO, y sin FEFO la bodega
 *    despacha lo que encuentra.
 */

create or replace view inbound_progress as
  select
    d.id,
    d.pedido,
    d.status,
    d.planned_at,
    count(p.id)::integer as pallets,
    count(p.received_at)::integer as recibidos,
    count(distinct p.product_id)::integer as materiales,
    sum(p.qty_cases) as cajas,
    d.sin_aviso,
    d.nota,
    d.origin_plant
  from inbound_doc d
  left join inbound_pallet p on p.doc_id = d.id
  group by d.id;

grant select on inbound_progress to authenticated;

create or replace function recibir_sin_aviso(
  p_pedido text,
  p_codigo text,
  p_qty_cases numeric,
  p_dock_location_id uuid,
  p_lot text default null,
  p_expiry date default null,
  p_pallet_code text default null,
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
language plpgsql security definer set search_path = public as $$
declare
  v_doc inbound_doc;
  v_prod record;
  v_matricula text;
  v_lote text;
  v_res record;
  v_cuenta record;
  v_linea smallint;
  v_propia boolean;
begin
  if auth.uid() is null then
    raise exception 'Hace falta una sesión para recibir';
  end if;
  if p_qty_cases is null or p_qty_cases <= 0 then
    raise exception 'Escribe cuántas cajas trae el pallet';
  end if;

  v_lote := nullif(trim(coalesce(p_lot, '')), '');
  if v_lote is null then
    raise exception 'Escribe el lote: sin documento, nadie lo puede reconstruir después';
  end if;
  if p_expiry is null then
    raise exception 'Escribe el vencimiento: sin él no hay FEFO';
  end if;

  select * into v_doc from inbound_doc where pedido = trim(p_pedido) for update;
  if not found then
    raise exception 'No hay ningún ingreso con el código %', trim(p_pedido);
  end if;
  if not v_doc.sin_aviso then
    raise exception 'El ingreso % tiene documento: recibe escaneando los pallets de la lista',
      v_doc.pedido;
  end if;
  if v_doc.status in ('CLOSED', 'CANCELLED') then
    raise exception 'El ingreso % ya está cerrado', v_doc.pedido;
  end if;

  select * into v_prod from producto_para_recibir(p_codigo);
  if v_prod.case_id is null then
    raise exception 'A % le falta el corrugado en el maestro: no se puede recibir por cajas',
      v_prod.sku;
  end if;

  v_matricula := nullif(trim(coalesce(p_pallet_code, '')), '');
  v_propia := v_matricula is null;
  if v_propia then
    v_matricula := 'WMS-' || lpad(nextval('matricula_wms_seq')::text, 8, '0');
  end if;

  select * into v_res from receive_pallet(
    v_matricula, v_prod.product_id, v_prod.case_id, p_qty_cases, p_dock_location_id,
    v_lote, p_expiry, null, p_max_level
  );

  -- `receive_pallet` marca toda matrícula como venida de planta. Cuando la inventamos aquí
  -- eso no es cierto, y el catálogo ya tiene la palabra para decirlo.
  if v_propia then
    update lpn set source = 'PROVISIONAL' where id = v_res.lpn_id;
  end if;

  select coalesce(max(line_no), 0) + 1 into v_linea from inbound_line where doc_id = v_doc.id;

  insert into inbound_line (doc_id, line_no, product_id, qty_cases, lot, expiry_date)
  values (v_doc.id, v_linea, v_prod.product_id, p_qty_cases, v_lote, p_expiry);

  insert into inbound_pallet (
    doc_id, pallet_code, product_id, qty_cases, lot, expiry_date, received_lpn_id, received_at
  )
  values (
    v_doc.id, v_matricula, v_prod.product_id, p_qty_cases, v_lote, p_expiry, v_res.lpn_id, now()
  );

  update inbound_doc set status = 'RECEIVING' where id = v_doc.id and status <> 'RECEIVING';

  select count(*)::integer as total, count(received_at)::integer as hechos
  into v_cuenta
  from inbound_pallet where doc_id = v_doc.id;

  return query select
    v_res.lpn_code, v_res.to_location_code, v_prod.sku, v_prod.name, p_qty_cases,
    v_cuenta.hechos, v_cuenta.total;
end;
$$;

grant execute on function recibir_sin_aviso to authenticated;
