-- Sólo sube lo que cambió
--
-- Los reportes de SAP se bajan y se suben cada media hora, y cada vez va el archivo entero: el
-- ZRDT de noviembre son 25,873 filas, trece envíos de dos mil. Casi todo eso ya estaba en la
-- base idéntico desde la subida anterior. Supabase cobra ese tráfico y la bodega lo paga en
-- espera, porque la pantalla no termina hasta que vuelve la última tanda.
--
-- No se arregla mandando sólo las filas nuevas, y aquí está el por qué. SAP no marca los
-- complementos: un transporte que esta mañana traía 20 líneas puede aparecer en el archivo de
-- las once con 27, sin que nada diga cuáles son las siete nuevas. Si se mandaran sólo las filas
-- que no estaban, el documento quedaría a medias; por eso las funciones de carga rehacen el
-- documento entero cada vez. La unidad mínima que se puede mandar o no mandar es el **documento
-- completo**, nunca la fila.
--
-- Así que se guarda una huella por documento: un resumen corto de todas sus filas, calculado en
-- la máquina de quien sube el archivo. Antes de enviar nada, la pantalla pregunta por las
-- huellas que la base ya tiene y manda sólo los documentos cuya huella no coincide. Un
-- transporte que creció de 20 a 27 líneas cambia de huella y viaja entero; uno que no cambió no
-- viaja. Subir dos veces el mismo archivo manda cero filas la segunda vez.
--
-- La huella se guarda **sólo de lo que de verdad entró**. Un camión que ya se abrió no se
-- reescribe —sus tareas ya están repartidas—, así que su complemento se queda fuera; si se le
-- guardara la huella no se volvería a intentar nunca y el complemento se perdería en silencio.
-- Sin huella, cada subida lo vuelve a ofrecer, y ahora además sale dicho en la pantalla.

create table if not exists carga_huella (
  kind text not null check (kind in ('INGRESO', 'DESPACHO', 'SALIDAS')),
  codigo text not null,
  huella text not null,
  updated_at timestamptz not null default now(),
  primary key (kind, codigo)
);

comment on table carga_huella is
  'Un resumen corto de las filas con que se cargó cada documento, para no volver a mandarlo '
  'si el archivo nuevo lo trae igual. La calcula quien sube el archivo; la base sólo la '
  'compara y la guarda de lo que aplicó.';

/**
 * Las huellas que ya hay, de los documentos que se preguntan. Devuelve **una sola fila** con un
 * objeto `{codigo: huella}`: PostgREST corta cualquier respuesta en mil filas (`max_rows`) y un
 * archivo de despacho trae casi cuatrocientos camiones, así que una tabla se quedaría corta sin
 * avisar el día que crezcan.
 */
create or replace function huellas_de(p_kind text, p_codigos text[]) returns jsonb
language sql stable security definer set search_path = public as $f$
  select coalesce(jsonb_object_agg(codigo, huella), '{}'::jsonb)
  from carga_huella
  where kind = p_kind and codigo = any(coalesce(p_codigos, array[]::text[]));
$f$;

comment on function huellas_de(text, text[]) is
  'Las huellas guardadas de esos documentos, como {codigo: huella}. Lo que no esté aquí hay '
  'que mandarlo.';

/** Guarda la huella de los documentos que sí entraron. Nunca la de los que se saltaron. */
create or replace function guardar_huellas(p_kind text, p_huellas jsonb, p_fuera text[])
returns void
language sql security definer set search_path = public as $f$
  insert into carga_huella (kind, codigo, huella, updated_at)
  select p_kind, h.key, h.value #>> '{}', now()
  from jsonb_each(coalesce(p_huellas, '{}'::jsonb)) h
  where not (h.key = any(coalesce(p_fuera, array[]::text[])))
  on conflict (kind, codigo) do update set
    huella = excluded.huella,
    updated_at = now();
$f$;

/* ---------------------------------------------------------------------------------------
 * Las tres funciones de documento aceptan ahora las huellas de la tanda. El `drop` es
 * obligado: añadir un parámetro no reemplaza una función, crea otra con el mismo nombre.
 * -------------------------------------------------------------------------------------*/

drop function if exists cargar_ingresos(jsonb);
drop function if exists cargar_despachos(jsonb);
drop function if exists cargar_salidas(jsonb);

/**
 * Ingresos. La llave es el **pedido de traslado**, que es lo que viene impreso en el
 * Comprobante de Carga.
 *
 * Los ZRDN de 3010 (Issima), 3014 (Suavissimo) y 5006 (Tocoa) **vienen sin esa columna** —0 de
 * 3,162 filas—, así que para esos tres la llave que se guarda es la **entrega**. Mientras no
 * se sepa qué número trae el papel de esos camiones, se reciben a ciegas y estas filas no
 * estorban: son el diccionario para el día que se sepa.
 *
 * Aquí el complemento entra siempre, esté el pedido donde esté: a un camión que se está
 * descargando y al que SAP le agrega pallets hay que bajárselos igual. Lo ya recibido es lo
 * único que el archivo no corrige.
 */
create function cargar_ingresos(p_filas jsonb, p_huellas jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $f$
declare
  v_docs integer := 0;
  v_pallets integer := 0;
  v_lineas integer := 0;
  v_sin_producto integer := 0;
begin
  if not puede_cargar_sap() then
    raise exception 'No tienes permiso para cargar datos de SAP';
  end if;

  create temp table _in on commit drop as
  select
    f.pedido,
    f.pallet,
    f.material,
    p.id as product_id,
    f.cajas,
    nullif(f.lote, '') as lote,
    f.vencimiento,
    nullif(f.planta, '') as planta,
    f.fecha,
    nullif(f.entrega, '') as entrega,
    nullif(f.salida, '') as salida,
    nullif(f.mix, '') as mix,
    f.a_ciegas,
    nullif(f.centro, '') as centro
  from jsonb_to_recordset(p_filas) as f(
    pedido text, pallet text, material text, cajas numeric, lote text, vencimiento date,
    planta text, fecha date, entrega text, salida text, mix text, centro text,
    a_ciegas boolean
  )
  left join product p on p.sku = f.material;

  -- Lo que va a otro centro no es de esta bodega: en el ZRDN de Snacks son 7 filas que van a
  -- San Pedro Sula. Lo que viene sin destino se queda, que es como vienen las otras plantas.
  delete from _in
  where centro is not null
    and centro not in ((select min(sap_centro) from site), 'Comayagua');

  select count(*) into v_sin_producto from _in where product_id is null;
  delete from _in where product_id is null or pedido is null or pallet is null or cajas is null;

  with doc as (
    select
      pedido,
      min(mix) as mix,
      min(entrega) as entrega,
      min(salida) as salida,
      min(planta) as planta,
      min(fecha) as fecha,
      bool_or(a_ciegas) as a_ciegas
    from _in
    group by pedido
  ),
  guardado as (
    insert into inbound_doc (
      pedido, mix, entrega, goods_issue, origin_plant, planned_at, status, nota
    )
    select
      pedido, mix, entrega, salida, planta, fecha,
      case when salida is null then 'EXPECTED' else 'ARRIVED' end,
      case when a_ciegas then 'El reporte de esta planta no trae pedido de traslado.' end
    from doc
    on conflict (pedido) do update set
      mix = coalesce(excluded.mix, inbound_doc.mix),
      entrega = coalesce(excluded.entrega, inbound_doc.entrega),
      goods_issue = coalesce(excluded.goods_issue, inbound_doc.goods_issue),
      -- Lo que ya se empezó a recibir no vuelve atrás porque el archivo llegue otra vez.
      status = case
        when inbound_doc.status in ('RECEIVING', 'CLOSED', 'CANCELLED') then inbound_doc.status
        else excluded.status
      end,
      updated_at = now()
    returning 1
  )
  select count(*) into v_docs from guardado;

  with pal as (
    select
      d.id as doc_id,
      i.pallet,
      (array_agg(i.product_id))[1] as product_id,
      sum(i.cajas) as cajas,
      min(i.lote) as lote,
      min(i.vencimiento) as vencimiento
    from _in i
    join inbound_doc d on d.pedido = i.pedido
    group by d.id, i.pallet
  ),
  guardado as (
    insert into inbound_pallet (doc_id, pallet_code, product_id, qty_cases, lot, expiry_date)
    select doc_id, pallet, product_id, cajas, lote, vencimiento from pal
    on conflict (doc_id, pallet_code) do update set
      qty_cases = excluded.qty_cases,
      lot = coalesce(excluded.lot, inbound_pallet.lot),
      expiry_date = coalesce(excluded.expiry_date, inbound_pallet.expiry_date)
    -- Lo ya recibido es historia: el archivo no la corrige.
    where inbound_pallet.received_at is null
    returning 1
  )
  select count(*) into v_pallets from guardado;

  -- Las líneas se rehacen enteras, no se parchean. Son el resumen de los pallets, así que
  -- si el archivo trae otra cosa la lista buena es la nueva: parchear por número de línea
  -- deja renglones viejos que ya no están en ningún pallet. Nada apunta a `inbound_line`.
  delete from inbound_line
  where doc_id in (select d.id from inbound_doc d join _in i on i.pedido = d.pedido);

  with lin as (
    select
      d.id as doc_id,
      row_number() over (
        partition by d.id order by i.material, coalesce(i.lote, ''),
        coalesce(i.vencimiento, 'infinity'::date)
      )::smallint as line_no,
      (array_agg(i.product_id))[1] as product_id,
      sum(i.cajas) as cajas,
      i.lote,
      i.vencimiento
    from _in i
    join inbound_doc d on d.pedido = i.pedido
    group by d.id, i.material, i.lote, i.vencimiento
  ),
  guardado as (
    insert into inbound_line (doc_id, line_no, product_id, qty_cases, lot, expiry_date)
    select doc_id, line_no, product_id, cajas, lote, vencimiento from lin
    returning 1
  )
  select count(*) into v_lineas from guardado;

  perform guardar_huellas('INGRESO', p_huellas, null);

  return jsonb_build_object(
    'documentos', v_docs, 'pallets', v_pallets, 'lineas', v_lineas,
    'sin_producto', v_sin_producto
  );
end;
$f$;

/**
 * Despachos. La llave es el **número de transporte**, que es lo que lleva el código de barras
 * de la hoja: un transporte puede venir impreso en varias hojas y para la bodega es un solo
 * camión.
 *
 * El camión entra **sin abrir** (`DRAFT`) y sin andén. Abrirlo es escanearlo, y el andén lo
 * pone quien lo recibe: el archivo de SAP no dice en qué andén se carga, y adivinarlo sería
 * inventar. Las líneas con cantidad cero no entran —1,147 de 25,873, repartidas en 239 de los
 * 389 camiones—: traen material y posición pero nada que surtir.
 *
 * Un camión ya abierto no se reescribe: sus tareas están repartidas y puede haber gente
 * surtiéndolo. Si el archivo nuevo le trae más líneas, **se cuenta y se dice** en vez de
 * desaparecer sin más, y no se le guarda la huella, para que el complemento siga ofreciéndose
 * en cada subida hasta que alguien decida qué hacer con él.
 */
create function cargar_despachos(p_filas jsonb, p_huellas jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $f$
declare
  v_camiones integer := 0;
  v_lineas integer := 0;
  v_sin_producto integer := 0;
  v_abiertos text[];
begin
  if not puede_cargar_sap() then
    raise exception 'No tienes permiso para cargar datos de SAP';
  end if;

  create temp table _out on commit drop as
  select
    f.transporte,
    f.entrega,
    f.posicion,
    f.material,
    p.id as product_id,
    pl.id as packaging_level_id,
    -- La unidad de venta decide cuántas unidades base es cada línea: la caja trae las suyas,
    -- la docena son doce —los 89 materiales que se piden en docenas tienen la caja en
    -- múltiplo de 12, los 89— y la unidad es una.
    f.cantidad * case f.um
      when 'CA' then coalesce(pl.qty_base_units, 1)
      when 'DOC' then 12
      else 1
    end as qty_base,
    nullif(f.cliente, '') as cliente
  from jsonb_to_recordset(p_filas) as f(
    transporte text, entrega text, posicion integer, material text, cantidad numeric,
    um text, cliente text
  )
  left join product p on p.sku = f.material
  left join packaging_level pl on pl.product_id = p.id and pl.code = 'CASE';

  select count(*) into v_sin_producto from _out where product_id is null;
  delete from _out where product_id is null or transporte is null or not (qty_base > 0);

  -- Los que ya estaban abiertos antes de tocar nada: ésos no se reescriben.
  select coalesce(array_agg(distinct x.transporte), array[]::text[]) into v_abiertos
  from _out x
  join sales_order o on o.code = x.transporte
  where o.status <> 'DRAFT';

  with camion as (
    select
      transporte,
      array_agg(distinct entrega order by entrega) as entregas,
      min(cliente) as cliente
    from _out
    group by transporte
  ),
  guardado as (
    insert into sales_order (code, transporte, entregas, customer)
    select transporte, transporte, entregas, cliente from camion
    on conflict (code) do update set
      entregas = excluded.entregas,
      customer = coalesce(excluded.customer, sales_order.customer)
    -- Un camión que ya se abrió no se reescribe: sus tareas ya están repartidas.
    where sales_order.status = 'DRAFT'
    returning 1
  )
  select count(*) into v_camiones from guardado;

  -- Igual que en el ingreso: las líneas del camión se rehacen enteras. Sólo se tocan las de
  -- un camión sin abrir, que por definición no tiene nada apartado ni chequeado —apartar es
  -- lo que hace `release_order`—, así que no hay nada colgando de ellas.
  delete from order_line
  where order_id in (
    select o.id from sales_order o join _out x on x.transporte = o.code where o.status = 'DRAFT'
  );

  with lin as (
    select
      o.id as order_id,
      row_number() over (partition by o.id order by x.entrega, x.posicion)::smallint as line_no,
      (array_agg(x.product_id))[1] as product_id,
      (array_agg(x.packaging_level_id))[1] as packaging_level_id,
      sum(x.qty_base) as qty_base
    from _out x
    join sales_order o on o.code = x.transporte and o.status = 'DRAFT'
    group by o.id, x.entrega, x.posicion
  ),
  guardado as (
    insert into order_line (order_id, line_no, product_id, packaging_level_id, qty_base)
    select order_id, line_no, product_id, packaging_level_id, qty_base from lin
    returning 1
  )
  select count(*) into v_lineas from guardado;

  perform guardar_huellas('DESPACHO', p_huellas, v_abiertos);

  return jsonb_build_object(
    'camiones', v_camiones, 'lineas', v_lineas, 'sin_producto', v_sin_producto,
    'ya_abiertos', coalesce(array_length(v_abiertos, 1), 0)
  );
end;
$f$;

/**
 * Las salidas de planta. De todo el ZMB51 sólo sirven los movimientos **641**, que son los que
 * traen pedido de traslado; y el 40% de los camiones que llegan a Comayagua vienen de plantas
 * que el ZRDN no cubre, así que ésta es su única vía.
 *
 * Trae material y cantidad, **nunca pallet, lote ni vencimiento** —el lote viene vacío en las
 * 1,111 filas y columna de vencimiento no hay—, así que crea el documento y sus líneas y deja
 * los pallets para el andén. Si ese mismo pedido ya entró por el ZRDN, que sí trae pallets, no
 * se le toca nada.
 */
create function cargar_salidas(p_filas jsonb, p_huellas jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $f$
declare
  v_docs integer := 0;
  v_lineas integer := 0;
  v_sin_producto integer := 0;
begin
  if not puede_cargar_sap() then
    raise exception 'No tienes permiso para cargar datos de SAP';
  end if;

  create temp table _sal on commit drop as
  select f.pedido, f.documento, f.material, p.id as product_id, f.cantidad, f.centro, f.fecha
  from jsonb_to_recordset(p_filas) as f(
    pedido text, documento text, material text, cantidad numeric, centro text,
    centro_receptor text, clase text, fecha date
  )
  left join product p on p.sku = f.material
  where f.centro_receptor = (select min(sap_centro) from site);

  select count(*) into v_sin_producto from _sal where product_id is null;
  delete from _sal where product_id is null or pedido is null or not (cantidad > 0);

  with doc as (
    select pedido, min(documento) as documento, min(centro) as centro, min(fecha) as fecha
    from _sal
    group by pedido
  ),
  guardado as (
    insert into inbound_doc (pedido, goods_issue, origin_plant, planned_at, status)
    select pedido, documento, centro, fecha, 'ARRIVED' from doc
    on conflict (pedido) do update set
      goods_issue = coalesce(inbound_doc.goods_issue, excluded.goods_issue),
      updated_at = now()
    returning 1
  )
  select count(*) into v_docs from guardado;

  -- Si el pedido ya vino por el ZRDN, sus líneas traen lote y vencimiento: no se tocan.
  delete from _sal s
  where exists (
    select 1 from inbound_doc d join inbound_pallet ip on ip.doc_id = d.id
    where d.pedido = s.pedido
  );

  delete from inbound_line
  where doc_id in (select d.id from inbound_doc d join _sal s on s.pedido = d.pedido);

  with lin as (
    select
      d.id as doc_id,
      row_number() over (partition by d.id order by s.material)::smallint as line_no,
      (array_agg(s.product_id))[1] as product_id,
      sum(s.cantidad) as cantidad
    from _sal s
    join inbound_doc d on d.pedido = s.pedido
    group by d.id, s.material
  ),
  guardado as (
    insert into inbound_line (doc_id, line_no, product_id, qty_cases)
    select doc_id, line_no, product_id, cantidad from lin
    returning 1
  )
  select count(*) into v_lineas from guardado;

  perform guardar_huellas('SALIDAS', p_huellas, null);

  return jsonb_build_object(
    'documentos', v_docs, 'lineas', v_lineas, 'sin_producto', v_sin_producto
  );
end;
$f$;

alter table carga_huella enable row level security;

grant execute on function huellas_de to authenticated, service_role;
grant execute on function guardar_huellas to service_role;
grant execute on function cargar_ingresos to authenticated, service_role;
grant execute on function cargar_despachos to authenticated, service_role;
grant execute on function cargar_salidas to authenticated, service_role;
