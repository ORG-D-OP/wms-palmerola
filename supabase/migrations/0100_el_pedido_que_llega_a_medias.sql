-- El pedido que llega a medias
--
-- La descarga de SAP no tiene una ventana fija. El ZRDT y los cuatro ZRDN se bajan cada día, a
-- veces con el mes entero y a veces con los últimos dos días, y el WMS tiene que dar lo mismo
-- en los dos casos: nadie va a esperar a que un documento esté completo para mandarlo.
--
-- En el despacho eso ya se cumple y está medido: las seis fechas del ZRDT son del transporte,
-- no de la línea —0 de 389 transportes traen más de una—, así que una ventana se lleva el
-- camión entero o no se lo lleva.
--
-- En el ingreso no. La `Fecha` del ZRDN es la del **pallet**, no la del pedido: de los 183
-- pedidos del archivo de Snacks, **18 tienen pallets de dos días distintos**. Una ventana de
-- dos días se lleva la mitad de esos pedidos, y ahí estaba el agujero: los pallets se acumulan
-- bien —nunca se borra ninguno— pero las líneas, que son su resumen, se rehacían **con las
-- filas del archivo** en lugar de con los pallets que hay. Medido: un pedido con P1 de 30 cajas
-- y P2 de 40 quedaba en 70; al día siguiente llegaba la ventana corta con P2 y P3 de 50, los
-- tres pallets quedaban guardados —120 cajas— y la línea decía **90**. Ese 90 es lo que el
-- andén ve como lo que se espera.
--
-- La línea es el resumen de los pallets, así que se arma de los pallets. De dónde vino el
-- archivo o qué trozo traía deja de importar.
--
-- Y sólo se rehacen las líneas de los documentos que **ya tienen pallets**. Un pedido que entró
-- por el ZMB51 tiene líneas y no tiene pallets; si llegara un ZRDN suyo con el material fuera
-- del maestro, rehacerle las líneas desde cero lo dejaría vacío.

create or replace function cargar_ingresos(p_filas jsonb, p_huellas jsonb default '{}'::jsonb)
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

  -- Los pallets se acumulan: no se borra ninguno porque el archivo de hoy no lo traiga. Eso es
  -- lo que hace que una ventana corta no pierda nada.
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

  -- Los documentos de este archivo a los que se les va a rehacer el resumen: los que tienen
  -- pallets. Un pedido que entró por el ZMB51 no tiene, y sus líneas no se tocan aquí.
  create temp table _docs on commit drop as
  select distinct d.id
  from inbound_doc d
  join _in i on i.pedido = d.pedido
  where exists (select 1 from inbound_pallet ip where ip.doc_id = d.id);

  delete from inbound_line where doc_id in (select id from _docs);

  with lin as (
    select
      ip.doc_id,
      row_number() over (
        partition by ip.doc_id
        order by p.sku, coalesce(ip.lot, ''), coalesce(ip.expiry_date, 'infinity'::date)
      )::smallint as line_no,
      ip.product_id,
      sum(ip.qty_cases) as cajas,
      ip.lot,
      ip.expiry_date
    from inbound_pallet ip
    join product p on p.id = ip.product_id
    where ip.doc_id in (select id from _docs)
    group by ip.doc_id, ip.product_id, p.sku, ip.lot, ip.expiry_date
  ),
  guardado as (
    insert into inbound_line (doc_id, line_no, product_id, qty_cases, lot, expiry_date)
    select doc_id, line_no, product_id, cajas, lot, expiry_date from lin
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

grant execute on function cargar_ingresos to authenticated, service_role;
