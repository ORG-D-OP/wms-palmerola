/**
 * El camión que nadie anunció.
 *
 * Hay bodegas y productos que no mandan el archivo de ingreso: avisan por correo, con un
 * papel, o no avisan. Hasta ahora el sistema no admitía ese caso —`inbound_doc.pedido` es
 * obligatorio y el detalle tiene que existir antes de recibir—, así que un camión sin
 * documento no se podía ni empezar a descargar.
 *
 * La salida es invertir la dependencia: en vez de exigir el documento para recibir, **el
 * documento se construye recibiendo**. La bodega abre el ingreso con un código propio, va
 * escaneando lo que baja, y al cerrarlo queda un acta de lo que entró de verdad. Eso es lo
 * que después se cruza contra lo que el proveedor diga que mandó.
 */

alter table inbound_doc
  add column if not exists sin_aviso boolean not null default false,
  add column if not exists nota text check (nota is null or length(nota) <= 500);

comment on column inbound_doc.sin_aviso is
  'En true el documento lo abrió la bodega al ver el camión, no SAP: el detalle se llena recibiendo.';
comment on column inbound_doc.nota is
  'De dónde dijeron que viene y cualquier cosa que el chequeador necesite dejar escrita.';

-- El código se ve distinto a propósito: 'SA-261109-01' no se confunde con un pedido de SAP,
-- que son ocho dígitos. Nadie lo escanea —el ingreso se abre con un botón— así que no le
-- estorba al lector.
create sequence if not exists ingreso_sin_aviso_seq;

-- 0012 quitó la secuencia de matrículas porque desde entonces la etiqueta del pallet siempre
-- viene de planta. Recibir a ciegas la trae de vuelta, pero con otro prefijo: 'WMS-...' dice
-- a la cara que esa matrícula la inventó el sistema porque el pallet no traía ninguna legible.
-- Un pallet así no se puede buscar por su etiqueta —no la tiene—, sólo por dónde quedó.
create sequence if not exists matricula_wms_seq;

create or replace function abrir_ingreso_sin_aviso(
  p_origen text default null,
  p_nota text default null
) returns inbound_doc
language plpgsql security definer set search_path = public as $$
declare
  v_doc inbound_doc;
begin
  if not has_role('chequeador', 'supervisor', 'admin') then
    raise exception 'No tienes permiso para abrir un ingreso';
  end if;

  insert into inbound_doc (pedido, origin_plant, nota, sin_aviso, status, planned_at)
  values (
    'SA-' || to_char(now(), 'YYMMDD') || '-' ||
      lpad((nextval('ingreso_sin_aviso_seq') % 100)::text, 2, '0'),
    nullif(trim(p_origen), ''),
    nullif(trim(p_nota), ''),
    true,
    'ARRIVED',
    current_date
  )
  returning * into v_doc;

  return v_doc;
end;
$$;

grant execute on function abrir_ingreso_sin_aviso to authenticated;

/**
 * Qué producto es el que tengo en la mano.
 *
 * El DUN-14 no distingue variantes: 61244.4, 61244C4 y 61244P4 comparten código porque son
 * el mismo producto en cartón y en plástico. Cuando pasa eso no se adivina: se pide el SKU.
 */
create or replace function producto_para_recibir(p_codigo text)
returns table (product_id uuid, sku text, name text, requires_fefo boolean, case_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  v_codigo text := trim(p_codigo);
  v_ids uuid[];
begin
  select array_agg(distinct p.id) into v_ids
  from product p where p.sku = v_codigo and p.status = 'active';

  if v_ids is null then
    select array_agg(distinct p.id) into v_ids
    from barcode b
    join packaging_level pl on pl.id = b.packaging_level_id
    join product p on p.id = pl.product_id
    where b.code = v_codigo and p.status = 'active';
  end if;

  if v_ids is null then
    raise exception 'No existe ese SKU ni ese código de barras';
  end if;
  if array_length(v_ids, 1) > 1 then
    raise exception 'Ese código lo comparten varios productos. Escribe el SKU';
  end if;

  return query
  select p.id, p.sku, p.name, p.requires_fefo, pl.id
  from product p
  left join packaging_level pl on pl.product_id = p.id and pl.code = 'CASE'
  where p.id = v_ids[1];
end;
$$;

grant execute on function producto_para_recibir to authenticated;

/**
 * Recibe un pallet de un ingreso sin aviso, y de paso lo agrega al documento.
 *
 * `p_pallet_code` es la matrícula cuando el pallet trae etiqueta legible —la de planta, o una
 * impresa aquí— y va en null cuando no hay ninguna: entonces el WMS genera la suya para poder
 * seguirle el rastro. Un pallet sin identidad no existe para el sistema; lo que no se puede es
 * dejar de recibirlo por eso.
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
    nullif(trim(coalesce(p_lot, '')), ''), p_expiry, null, p_max_level
  );

  -- `receive_pallet` marca toda matrícula como venida de planta. Cuando la inventamos aquí
  -- eso no es cierto, y el catálogo ya tiene la palabra para decirlo.
  if v_propia then
    update lpn set source = 'PROVISIONAL' where id = v_res.lpn_id;
  end if;

  select coalesce(max(line_no), 0) + 1 into v_linea from inbound_line where doc_id = v_doc.id;

  insert into inbound_line (doc_id, line_no, product_id, qty_cases, lot, expiry_date)
  values (v_doc.id, v_linea, v_prod.product_id, p_qty_cases, p_lot, p_expiry);

  insert into inbound_pallet (
    doc_id, pallet_code, product_id, qty_cases, lot, expiry_date, received_lpn_id, received_at
  )
  values (
    v_doc.id, v_matricula, v_prod.product_id, p_qty_cases, p_lot, p_expiry, v_res.lpn_id, now()
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

/**
 * Cierra el ingreso: el acta queda como está y no se le puede agregar nada más.
 *
 * Sólo aplica a los ingresos sin aviso. Los que vienen con documento se cierran solos cuando
 * el último pallet de la lista entra, porque ahí sí se sabe cuántos eran.
 */
create or replace function cerrar_ingreso_sin_aviso(p_pedido text) returns inbound_doc
language plpgsql security definer set search_path = public as $$
declare
  v_doc inbound_doc;
begin
  if not has_role('chequeador', 'supervisor', 'admin') then
    raise exception 'No tienes permiso para cerrar un ingreso';
  end if;

  select * into v_doc from inbound_doc where pedido = trim(p_pedido) for update;
  if not found then
    raise exception 'No hay ningún ingreso con el código %', trim(p_pedido);
  end if;
  if not v_doc.sin_aviso then
    raise exception 'El ingreso % se cierra solo cuando entra el último pallet de la lista',
      v_doc.pedido;
  end if;
  if v_doc.status = 'CLOSED' then
    raise exception 'El ingreso % ya está cerrado', v_doc.pedido;
  end if;

  update inbound_doc set status = 'CLOSED' where id = v_doc.id returning * into v_doc;
  return v_doc;
end;
$$;

grant execute on function cerrar_ingreso_sin_aviso to authenticated;

-- Los ingresos abiertos que la bodega misma creó: lo primero que necesita ver el chequeador
-- que llega al andén y encuentra un camión a medio descargar.
create or replace view ingreso_abierto as
  select
    d.id,
    d.pedido,
    d.status,
    d.nota,
    d.origin_plant,
    d.created_at,
    count(p.id)::integer as pallets,
    coalesce(sum(p.qty_cases), 0) as cajas,
    count(distinct p.product_id)::integer as materiales
  from inbound_doc d
  left join inbound_pallet p on p.doc_id = d.id
  where d.sin_aviso and d.status not in ('CLOSED', 'CANCELLED')
  group by d.id;

grant select on ingreso_abierto to authenticated;
