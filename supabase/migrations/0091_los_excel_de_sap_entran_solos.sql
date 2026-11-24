/**
 * Los cinco Excel de SAP dejan de ser archivos sueltos y pasan a ser datos del sistema.
 *
 * Hasta hoy sólo entraba uno —el ZRDN de ingresos, por un script de consola— y el despacho se
 * armaba a mano. Revisados los archivos del 1 al 16 de noviembre, lo que hay es esto:
 *
 * | Archivo | Para qué | Qué trae |
 * |---|---|---|
 * | ZRDN (4 plantas) | ingreso | 8,497 pallets con lote y vencimiento en 8,497 |
 * | ZRDT | despacho | 25,873 líneas, 389 camiones, clave única en las 25,873 |
 * | Inventario | la foto de SAP | 1,635 filas, 9 almacenes del centro 1003 |
 * | Pronóstico | el ABC | 68,389 filas de Zona Centro, 362 materiales |
 * | ZMB51 | salidas de planta | hoy no sirve, y se explica abajo |
 *
 * **El despacho no tenía dónde entrar.** `sales_order` y `order_line` existen desde el
 * principio, pero nada los llenaba desde SAP: los 26 pedidos de la base son de prueba. Por eso
 * escanear un tabulado de despacho sólo funcionaba con datos inventados.
 *
 * **La foto de SAP y el pronóstico son tablas nuevas**, y ninguna de las dos toca `stock`.
 * `stock` es lo que la bodega contó; `sap_stock` es lo que SAP cree. Que difieran es
 * justamente el dato que interesa, así que mezclarlos sería borrar la pregunta.
 *
 * **Por qué el ZMB51 no entra todavía.** El puente entre el ZMB51 y el ZRDN era el movimiento
 * **641** —salida a stock en tránsito contra un pedido de traslado—, y el extracto nuevo no
 * trae ni uno: 1,090 líneas de clase 303 y 19 de 304, cero 641. Comprobado contra el extracto
 * viejo, donde sí había de los dos: sus 793 líneas de 641 traían pedido **las 793**, y los 29
 * documentos que cruzaban con el ZRDN eran **los 29 de clase 641**; de las 754 líneas de 303,
 * cruzaron **cero**. Y lo que queda en el extracto nuevo sin los 641 es, en su mayor parte,
 * envase: 814 de 1,111 líneas son tarimas de alquiler, corrugado de retorno y tarimas de
 * madera. Hasta que el reporte vuelva a traer los 641 no hay nada que atar.
 */

/* ---------------------------------------------------------------------------------------
 * 1. La foto de SAP
 * -------------------------------------------------------------------------------------*/

/**
 * Una fila por almacén y material, con la fecha de la foto. No se descarta ningún almacén:
 * del centro 1003 cuelgan varias bodegas y cuál es cuál es dato de la operación, no del
 * código. Las 149 filas que vienen sin almacén son existencia en tránsito —las cuatro
 * cantidades en cero y `Trans./Trasl.` por encima de cero en las 149—, así que el almacén
 * admite nulo.
 */
create table if not exists sap_stock (
  id uuid primary key default gen_random_uuid(),
  taken_on date not null,
  centro text not null,
  almacen text,
  sku text not null,
  name text,
  product_id uuid references product on delete set null,
  uom text not null,
  free_base numeric not null default 0,
  pending_base numeric not null default 0,
  blocked_base numeric not null default 0,
  transit_base numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique nulls not distinct (taken_on, centro, almacen, sku)
);

/**
 * Las cantidades se guardan en **unidades base**, no en cajas, porque el archivo las trae con
 * decimales: 876 de las 1,635 filas dicen cosas como `21,289.787 CA`. Esa fracción es la
 * suelta, y en unidades base deja de ser una fracción. Lo que no se puede convertir —material
 * que no está en el maestro— se guarda tal cual vino, en cajas, y por eso queda `uom`.
 */
comment on column sap_stock.free_base is
  'Libre utilización, en unidades base si el material está en el maestro; si no, como vino.';
comment on column sap_stock.transit_base is
  'La columna Trans./Trasl.: lo que va en camino y todavía no tiene almacén.';

create index if not exists sap_stock_producto on sap_stock (product_id, taken_on desc);

/* ---------------------------------------------------------------------------------------
 * 2. El pronóstico, y el ABC que sale de él
 * -------------------------------------------------------------------------------------*/

/**
 * Honduras viene partida en **Zona Centro** y **Zona Norte**, y Zona Centro es lo de esta
 * bodega: sus cinco organizaciones de venta —1001 Tegucigalpa, 1002 Danlí, 1003 Comayagua,
 * 1004 Choluteca y 1005 Olancho— son exactamente las cinco que aparecen despachando en el
 * ZRDT. Se guarda la zona para no tener que volver a decidirlo si algún día cambia.
 *
 * El archivo se llama «Nov-Ene» pero trae **doce períodos**, de 2026-11 a 2027-10. Se guardan
 * todos: el corte del ABC apenas se mueve entre tres meses y doce (82/78/194 contra
 * 79/80/203), así que el dato largo no estorba y permite mirar la temporada.
 */
create table if not exists product_forecast (
  id uuid primary key default gen_random_uuid(),
  zona text not null,
  sku text not null,
  product_id uuid references product on delete set null,
  name text,
  year smallint not null,
  period smallint not null check (period between 1 and 12),
  cases numeric not null,
  pallets numeric not null,
  cases_per_pallet integer,
  updated_at timestamptz not null default now(),
  unique (zona, sku, year, period)
);

comment on table product_forecast is
  'Pronóstico de venta por material y mes. De aquí sale la clase ABC y el espacio que pide '
  'cada producto. Verificado: «PP = Pronóstico / Cantidad cajas Pallet» en 68,269 de 68,269 '
  'filas con estiba, y la estiba y el peso de caja coinciden con el maestro en 357 de 357.';

create index if not exists product_forecast_producto on product_forecast (product_id);

/**
 * Qué centro de SAP es esta bodega es un dato del sitio, no una constante repetida por el
 * código. Comayagua es el 1003, y dentro de ese centro hay varias bodegas: el reporte de
 * ingreso trae `Sap Almacén Destino` **vacía en las 8,497 filas**, así que por centro es
 * hasta donde se puede filtrar. Lo que sobra no estorba: el sistema no arma lista de
 * recepciones esperadas, busca el documento cuando alguien escanea.
 */
alter table site add column if not exists sap_centro text not null default '1003';

/** Dónde se corta el ABC es decisión de la bodega, no una constante escondida en una vista. */
alter table site add column if not exists forecast_zone text not null default 'Zona Centro';
alter table site add column if not exists abc_a_pct smallint not null default 80;
alter table site add column if not exists abc_b_pct smallint not null default 95;

alter table site drop constraint if exists site_abc_check;
alter table site add constraint site_abc_check
  check (abc_a_pct between 1 and 99 and abc_b_pct between abc_a_pct + 1 and 100);

comment on column site.abc_a_pct is
  'Hasta qué porcentaje del volumen pronosticado es clase A. Con 80 salen 82 productos.';

/**
 * La clase sale del volumen **en pallets**, no en cajas: lo que ocupa espacio es el pallet, y
 * una caja de sopas y una de aceite no ocupan lo mismo. Es la misma decisión que ya estaba
 * tomada («ABC por volumen»), ahora con el número delante.
 */
create or replace view producto_abc as
with suma as (
  select
    f.product_id,
    f.sku,
    max(f.name) as name,
    sum(f.cases) as cajas,
    sum(f.pallets) as pallets
  from product_forecast f
  where f.zona = (select min(forecast_zone) from site)
  group by f.product_id, f.sku
),
acumulado as (
  select
    suma.*,
    sum(pallets) over (order by pallets desc, sku)
      / nullif(sum(pallets) over (), 0) * 100 as pct_acumulado
  from suma
)
select
  product_id,
  sku,
  name,
  cajas,
  pallets,
  round(pct_acumulado, 2) as pct_acumulado,
  case
    when pct_acumulado <= (select min(abc_a_pct) from site) then 'A'
    when pct_acumulado <= (select min(abc_b_pct) from site) then 'B'
    else 'C'
  end as clase
from acumulado;

/**
 * Lo que no tiene pronóstico cuenta como C. No es lo mismo que «se mueve poco», pero para
 * decidir dónde se guarda un pallet es lo mismo: nadie ha dicho que vaya a salir este mes.
 * Son 331 de los 690 del maestro, y lo único que les pasa es que se les ofrece primero el
 * fondo del almacén.
 */
create or replace function clase_abc(p_product_id uuid) returns text
language sql stable set search_path = public as $f$
  select coalesce((select clase from producto_abc where product_id = p_product_id), 'C');
$f$;

/* ---------------------------------------------------------------------------------------
 * 3. El ABC manda dónde se guarda
 * -------------------------------------------------------------------------------------*/

/**
 * Lo único que cambia es el orden en que se ofrecen los huecos: **lo que más sale se queda
 * cerca del andén y lo que menos sale se va al fondo**. No se le niega el hueco a nadie —si
 * sólo queda uno, ese se da—, y el resto de las condiciones (peso, carril de un solo producto,
 * lo que otro lleva en camino) queda igual que estaba.
 *
 * El recorrido es lo que paga la diferencia: 82 productos hacen el 80% de los pallets
 * pronosticados, así que ordenarlos bien se nota todos los días.
 */
create or replace function suggest_putaway_location(
  p_product_id uuid,
  p_lot text default null,
  p_expiry date default null,
  p_max_level smallint default null
) returns uuid
language sql stable security definer set search_path = public as $f$
  with estiba as (
    select total_weight_kg as peso
    from pallet_config
    where product_id = p_product_id and is_default
    limit 1
  ),
  clase as (select clase_abc(p_product_id) as c)
  select l.id
  from location l
  join lane la on la.id = l.lane_id
  join location_usage u on u.code = l.usage_code
  join location_area lar on lar.location_id = l.id and lar.valid_to is null
  join area a on a.id = lar.area_id
  join area_type tp on tp.code = a.type_code
  left join stock s on s.location_id = l.id and s.qty_base > 0
  left join estiba e on true
  cross join clase
  where l.retired_at is null
    and l.status = 'available'
    and l.reserved_by_task_id is null
    and u.holds_product
    and a.is_active
    and not tp.is_virtual
    and a.code = 'ALMACEN'
    and (p_max_level is null or coalesce(l.level, 0) <= p_max_level)
    and (l.max_weight_kg is null or e.peso is null or e.peso <= l.max_weight_kg)
    and pallets_que_caben(l.id, p_product_id) > 0
    and not exists (
      select 1 from stock otro
      join location ol on ol.id = otro.location_id
      where ol.lane_id = l.lane_id and otro.qty_base > 0
        and (otro.product_id <> p_product_id or otro.lot is distinct from p_lot)
    )
    and not exists (
      -- Lo que otro lleva en camino a ese carril cuenta igual que lo que ya está ahí.
      select 1 from location ol
      join task t on t.id = ol.reserved_by_task_id
      where ol.lane_id = l.lane_id
        and t.status not in ('DONE', 'CANCELLED')
        and (t.product_id is distinct from p_product_id or t.lot is distinct from p_lot)
    )
  order by
    (s.product_id is not null) desc,
    coalesce(l.level, 0),
    l.pick_sequence * case when clase.c = 'C' then -1 else 1 end nulls last,
    l.code
  limit 1;
$f$;

/**
 * Y la posición de picking que se le estrena a un producto se escoge igual: la más cercana
 * para lo que más sale. Antes se daba la primera por código, que es el orden del plano y no
 * dice nada del recorrido.
 */
create or replace function sugerir_posicion_inicial(p_codigo text, p_expiry date default null)
returns table (location_id uuid, code text, es_picking boolean)
language plpgsql stable security definer set search_path = public as $f$
declare
  v_prod record;
  v_id uuid;
  v_clase text;
begin
  select * into v_prod from producto_para_recibir(p_codigo);
  v_clase := clase_abc(v_prod.product_id);

  if not exists (
    select 1
    from stock s
    join location_area lar on lar.location_id = s.location_id and lar.valid_to is null
    join area a on a.id = lar.area_id and a.code = 'PICKING'
    where s.product_id = v_prod.product_id and s.qty_base > 0
  ) then
    select l.id into v_id
    from location l
    join location_usage u on u.code = l.usage_code
    join location_area lar on lar.location_id = l.id and lar.valid_to is null
    join area a on a.id = lar.area_id
    where a.code = 'PICKING'
      and a.is_active
      and u.holds_product
      and l.retired_at is null
      and l.status = 'available'
      and l.reserved_by_task_id is null
      and not exists (select 1 from stock s where s.location_id = l.id and s.qty_base > 0)
    order by
      coalesce(l.level, 0),
      l.pick_sequence * case when v_clase = 'C' then -1 else 1 end nulls last,
      l.code
    limit 1;

    if v_id is not null then
      return query select l.id, l.code, true from location l where l.id = v_id;
      return;
    end if;
  end if;

  v_id := suggest_putaway_location(v_prod.product_id, null, p_expiry);
  return query select l.id, l.code, false from location l where l.id = v_id;
end;
$f$;

/* ---------------------------------------------------------------------------------------
 * 4. El registro de subidas
 * -------------------------------------------------------------------------------------*/

/**
 * Una persona baja los reportes de SAP cada media hora y los sube. **El único indicador de
 * que esa cadena sigue viva es la hora de la última subida**: si lleva dos horas sin
 * moverse, alguien tiene que verlo. Por eso la subida deja rastro aunque no cambie nada.
 */
create table if not exists carga_sap (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (
    kind in ('INGRESO', 'DESPACHO', 'INVENTARIO', 'PRONOSTICO', 'SALIDAS', 'TRAZA')
  ),
  file_name text not null,
  rows_read integer not null,
  detail jsonb not null default '{}'::jsonb,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references profile on delete set null
);

create index if not exists carga_sap_reciente on carga_sap (kind, uploaded_at desc);

create or replace view ultima_carga as
select distinct on (kind)
  kind,
  file_name,
  rows_read,
  detail,
  uploaded_at,
  (select full_name from profile where id = carga_sap.uploaded_by) as persona
from carga_sap
order by kind, uploaded_at desc;

/* ---------------------------------------------------------------------------------------
 * 5. Las cuatro funciones de carga
 * -------------------------------------------------------------------------------------*/

/** La zona del pronóstico que le toca a esta bodega: el lector descarta las demás. */
create or replace function zona_del_pronostico() returns text
language sql stable security definer set search_path = public as $f$
  select min(forecast_zone) from site;
$f$;

/**
 * Quién puede cargar. Sin usuario es la llave de servicio, que sólo existe del lado del
 * servidor y que es como entra la carga inicial desde la consola; con usuario, tiene que ser
 * suyo. La llave anónima no alcanza ninguna de estas funciones: no tiene el permiso de
 * ejecución.
 */
create or replace function puede_cargar_sap() returns boolean
language sql stable set search_path = public as $f$
  select auth.uid() is null or has_role('supervisor', 'admin');
$f$;

/**
 * Cada una recibe las filas ya leídas del Excel como `jsonb` y las guarda. El Excel se lee en
 * el servidor de la aplicación —no hay lector de xlsx dentro de Postgres— pero **lo que toca
 * la base pasa por aquí**, en una sola transacción y con el permiso comprobado dentro, igual
 * que el resto de lo transaccional del sistema.
 *
 * Las cuatro son idempotentes: subir dos veces el mismo archivo deja lo mismo que subirlo una,
 * y subir uno viejo no pisa lo que ya se recibió.
 */

/**
 * Ingresos. La llave es el **pedido de traslado**, que es lo que viene impreso en el
 * Comprobante de Carga.
 *
 * Los ZRDN de 3010 (Issima), 3014 (Suavissimo) y 5006 (Tocoa) **vienen sin esa columna** —0 de
 * 3,162 filas—, así que para esos tres la llave que se guarda es la **entrega**. Mientras no
 * se sepa qué número trae el papel de esos camiones, se reciben a ciegas y estas filas no
 * estorban: son el diccionario para el día que se sepa.
 */
create or replace function cargar_ingresos(p_filas jsonb) returns jsonb
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
 */
create or replace function cargar_despachos(p_filas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $f$
declare
  v_camiones integer := 0;
  v_lineas integer := 0;
  v_sin_producto integer := 0;
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

  return jsonb_build_object(
    'camiones', v_camiones, 'lineas', v_lineas, 'sin_producto', v_sin_producto
  );
end;
$f$;

/** La foto de SAP. Se guarda entera, con su fecha; las fotos viejas no se borran. */
create or replace function cargar_inventario_sap(p_filas jsonb, p_fecha date) returns jsonb
language plpgsql security definer set search_path = public as $f$
declare
  v_filas integer := 0;
  v_sin_producto integer := 0;
begin
  if not puede_cargar_sap() then
    raise exception 'No tienes permiso para cargar datos de SAP';
  end if;

  with entrada as (
    select
      f.centro,
      nullif(f.almacen, '') as almacen,
      f.material,
      nullif(f.nombre, '') as nombre,
      p.id as product_id,
      f.uom,
      coalesce(pl.qty_base_units, 1) as por_caja,
      f.libre, f.pendiente, f.bloqueado, f.transito
    from jsonb_to_recordset(p_filas) as f(
      centro text, almacen text, material text, nombre text, uom text,
      libre numeric, pendiente numeric, bloqueado numeric, transito numeric
    )
    left join product p on p.sku = f.material
    left join packaging_level pl on pl.product_id = p.id and pl.code = 'CASE'
  ),
  guardado as (
    insert into sap_stock (
      taken_on, centro, almacen, sku, name, product_id, uom,
      free_base, pending_base, blocked_base, transit_base
    )
    select
      p_fecha, centro, almacen, material, nombre, product_id, uom,
      libre * por_caja, pendiente * por_caja, bloqueado * por_caja, transito * por_caja
    from entrada
    on conflict (taken_on, centro, almacen, sku) do update set
      name = excluded.name,
      product_id = excluded.product_id,
      free_base = excluded.free_base,
      pending_base = excluded.pending_base,
      blocked_base = excluded.blocked_base,
      transit_base = excluded.transit_base,
      updated_at = now()
    returning 1
  )
  select count(*) into v_filas from guardado;

  select count(*) into v_sin_producto
  from jsonb_to_recordset(p_filas) as f(material text)
  where not exists (select 1 from product where sku = f.material);

  return jsonb_build_object('filas', v_filas, 'sin_producto', v_sin_producto);
end;
$f$;

/** El pronóstico. Una fila por material y mes de la zona. */
create or replace function cargar_pronostico(p_filas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $f$
declare
  v_filas integer := 0;
  v_sin_producto integer := 0;
begin
  if not puede_cargar_sap() then
    raise exception 'No tienes permiso para cargar datos de SAP';
  end if;

  with guardado as (
    insert into product_forecast (
      zona, sku, product_id, name, year, period, cases, pallets, cases_per_pallet
    )
    select
      f.zona, f.material, p.id, nullif(f.nombre, ''), f.anio, f.periodo,
      f.cajas, f.pallets, nullif(f.cajas_por_pallet, 0)
    from jsonb_to_recordset(p_filas) as f(
      zona text, material text, nombre text, anio smallint, periodo smallint,
      cajas numeric, pallets numeric, cajas_por_pallet integer
    )
    left join product p on p.sku = f.material
    on conflict (zona, sku, year, period) do update set
      product_id = excluded.product_id,
      name = excluded.name,
      cases = excluded.cases,
      pallets = excluded.pallets,
      cases_per_pallet = excluded.cases_per_pallet,
      updated_at = now()
    returning 1
  )
  select count(*) into v_filas from guardado;

  select count(*) into v_sin_producto
  from jsonb_to_recordset(p_filas) as f(material text)
  where not exists (select 1 from product where sku = f.material);

  return jsonb_build_object('filas', v_filas, 'sin_producto', v_sin_producto);
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
 *
 * Hoy carga cero: el extracto del 16 de noviembre no tiene ni un 641.
 */
create or replace function cargar_salidas(p_filas jsonb) returns jsonb
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

  return jsonb_build_object(
    'documentos', v_docs, 'lineas', v_lineas, 'sin_producto', v_sin_producto
  );
end;
$f$;

/** Deja constancia de la subida, haya cambiado algo o no. */
create or replace function registrar_carga(
  p_kind text,
  p_file_name text,
  p_rows_read integer,
  p_detail jsonb
) returns void
language plpgsql security definer set search_path = public as $f$
begin
  if not puede_cargar_sap() then
    raise exception 'No tienes permiso para cargar datos de SAP';
  end if;

  insert into carga_sap (kind, file_name, rows_read, detail, uploaded_by)
  values (p_kind, p_file_name, p_rows_read, coalesce(p_detail, '{}'::jsonb), auth.uid());
end;
$f$;

/* ---------------------------------------------------------------------------------------
 * 6. El camión que llega sin andén
 * -------------------------------------------------------------------------------------*/

/**
 * El archivo de SAP no dice en qué andén se carga un camión, así que los 389 entran sin él y
 * `release_order` los rechazaba con «El pedido necesita un andén de carga» — un mensaje
 * correcto contra el que no había ninguna pantalla donde hacer nada.
 *
 * Ahora el andén se pone al abrirlo: el que tiene la hoja en la mano es el que sabe a qué
 * andén llegó el camión. Sigue valiendo lo de la 0075 —un pedido apunta a un solo andén de
 * despacho—, y por eso esto sólo deja poner el andén mientras el camión está sin abrir.
 */
create or replace function poner_anden(p_order_id uuid, p_anden text) returns void
language plpgsql security definer set search_path = public as $f$
declare
  v_dock uuid;
  v_status order_status;
begin
  if not has_role('auxiliar', 'chequeador', 'montacargista', 'supervisor', 'admin') then
    raise exception 'No tienes permiso para abrir un despacho';
  end if;

  select status into v_status from sales_order where id = p_order_id for update;
  if not found then
    raise exception 'El pedido no existe';
  end if;
  if v_status <> 'DRAFT' then
    raise exception 'El camión ya está abierto: su andén no se cambia desde aquí';
  end if;

  select dock_door_id into v_dock from anden_de_carga where anden = trim(p_anden);
  if v_dock is null then
    raise exception 'El andén % no es de carga', p_anden;
  end if;

  update sales_order set dock_door_id = v_dock where id = p_order_id;
end;
$f$;

/* ---------------------------------------------------------------------------------------
 * 7. Permisos
 * -------------------------------------------------------------------------------------*/

alter table sap_stock enable row level security;
alter table product_forecast enable row level security;
alter table carga_sap enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['sap_stock', 'product_forecast', 'carga_sap'] loop
    execute format('drop policy if exists %1$s_read on %1$s', t);
    execute format(
      'create policy %1$s_read on %1$s for select to authenticated using (true)', t
    );
    execute format('grant select on %s to authenticated', t);
  end loop;
end;
$$;

grant select on producto_abc, ultima_carga to authenticated;

grant execute on function clase_abc to authenticated;
grant execute on function puede_cargar_sap to authenticated;
grant execute on function zona_del_pronostico to authenticated, service_role;
grant execute on function cargar_ingresos to authenticated;
grant execute on function cargar_despachos to authenticated;
grant execute on function cargar_inventario_sap to authenticated;
grant execute on function cargar_pronostico to authenticated;
grant execute on function cargar_salidas to authenticated;
grant execute on function registrar_carga to authenticated;
grant execute on function poner_anden to authenticated;

-- La carga inicial entra desde la consola con la llave de servicio, no desde la pantalla.
grant execute on function cargar_ingresos, cargar_despachos, cargar_inventario_sap,
  cargar_pronostico, cargar_salidas, registrar_carga to service_role;
