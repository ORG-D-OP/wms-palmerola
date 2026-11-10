/**
 * Qué se escanea al recibir a ciegas, y qué es obligatorio de verdad.
 *
 * La captura tenía dos cosas mal. La primera es que pedía un solo escaneo —"una caja o el
 * SKU"— cuando en el andén hay dos etiquetas distintas que leer: la del pallet, que dice
 * cuál es este bulto, y la de una caja, que dice qué producto trae. Son dos preguntas y se
 * escanean en ese orden, porque el pallet es lo primero que el operario tiene enfrente.
 * Ninguna de las dos es obligatoria: el pallet puede venir sin etiqueta Nest y la caja
 * puede traer un código que no esté en el maestro. Lo que no puede faltar es el producto,
 * que entonces se escribe.
 *
 * La segunda es el lote. La 0039 lo volvió obligatorio con el argumento de que sin
 * documento nadie lo reconstruye. El argumento era cierto para el vencimiento y se estiró
 * de más al lote: el FEFO sale de la fecha, no del lote, y exigir un lote que a veces no
 * está impreso en ninguna parte sólo consigue que alguien invente uno. Un lote inventado
 * es peor que un lote vacío, porque miente en una trazabilidad que después se usa para
 * rastrear un producto. El vencimiento sigue siendo obligatorio.
 */

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
