-- Un camión, un documento
--
-- Medido el 25/11/2026, con el ZRDN del 1 al 16 y el MB51 «WMS Comayagua» del 1 al 25: **312
-- documentos de ingreso tienen líneas y cero pallets**, y ninguno de los 312 se puede recibir.
-- Al escanear ese pedido sale la lista vacía y la frase «Los 0 pallets del pedido X están
-- recibidos»; por pallet corta con «El pallet X no es de este pedido» y a ciegas con «El
-- ingreso X tiene documento: recibe escaneando los pallets de la lista». Callejón sin salida.
--
-- **De esos 312, 116 son el mismo camión dos veces.** El ZRDN de 3010, 3014 y 5006 no trae
-- pedido de traslado —0 de 3,162 filas— y esos camiones se guardan bajo su entrega; el MB51
-- los guarda bajo su pedido. El camión de Tocoa del 9 de noviembre está como `60214289`, con 3
-- líneas y 0 pallets, y otra vez como `700158082`, con 8 líneas y 27 pallets. Es el mismo.
--
-- La llave para atarlos ya viene en el archivo: el MB51 trae `Pedido` y `Referencia`, y la
-- `Referencia` es la entrega. Aquí se usa para tres cosas:
--
--   1. **Buscar antes de crear.** Un camión que ya está bajo su entrega no se abre otra vez
--      bajo su pedido: se le completan las dos llaves al que ya existe.
--   2. **Juntar lo que ya se partió.** Cuando aparecen los dos, gana el que tiene los pallets
--      —que es el que lleva lote y vencimiento— y el otro se borra con sus líneas.
--   3. **Encontrarlo con cualquiera de sus números.** El chequeador escanea lo que trae
--      impreso el papel, y eso es a veces el pedido, a veces la entrega y a veces el vale.
--
-- Y el documento que sólo anuncia SAP nace `sin_aviso`, que es lo que ya significaba «este
-- camión no trae lista de pallets»: con eso la pantalla de siempre deja recibirlo escaneando
-- cada producto, sin tocar una línea de la aplicación.
--
-- `sin_aviso` no se vuelve a apagar desde aquí. Recibir a ciegas crea pallets, así que mirar
-- si hay pallets para decidirlo dejaría al chequeador encerrado después del primero. Lo apaga
-- `cargar_ingresos`, que es quien de verdad trae una lista.

-- Y dos cosas más que el mismo camión destapó. Seis líneas del MB51 se caían porque el
-- material no estaba en el maestro, y con ellas parte del camión: ahora ese material se da de
-- alta con el nombre que trae el archivo. Como nace sin clase, y sin clase todo se guarda
-- como alimento, la elige el que lo recibe, que es el único que lo tiene delante.

alter table inbound_doc add column if not exists cajas_sap numeric;

comment on column inbound_doc.cajas_sap is
  'Las cajas que el movimiento 641 de SAP dice que salieron de planta. Las etiquetas del ZRDN '
  'mandan sobre esto, porque son lo que viene físicamente en el camión, pero cuando no cuadran '
  'el andén tiene que saberlo: medido el 25/11/2026, 8 líneas de 186 pedidos y 291 cajas de '
  '157,827 (0.18%).';

-- El camión por cualquiera de los números que trae impreso el papel. El pedido primero, que es
-- el que manda; después la entrega, el vale de acompañamiento y el envío de NEST.
create or replace function ingreso_por_codigo(p_codigo text)
returns uuid language sql stable security definer set search_path = public as $f$
  with buscado as (select ltrim(trim(p_codigo), '0') as c)
  select d.id
  from inbound_doc d, buscado
  where buscado.c <> '' and buscado.c in (
    ltrim(d.pedido, '0'),
    ltrim(coalesce(d.entrega, ''), '0'),
    ltrim(coalesce(d.goods_issue, ''), '0'),
    ltrim(coalesce(d.mix, ''), '0')
  )
  order by
    (ltrim(d.pedido, '0') = buscado.c) desc,
    (ltrim(coalesce(d.entrega, ''), '0') = buscado.c) desc,
    d.created_at
  limit 1;
$f$;

comment on function ingreso_por_codigo(text) is
  'El documento de ingreso por pedido, entrega, vale de salida o envío de NEST. Un mismo camión '
  'viaja con varios números y el papel no siempre trae el mismo.';

grant execute on function ingreso_por_codigo to authenticated, service_role;

-- El material que el maestro no tiene ------------------------------------------------------

-- Medido el 25/11/2026: de las 1,128 líneas del MB51, **6 se caían porque el material no está
-- en el maestro**, y con ellas el camión entero se quedaba sin esa parte. Un camión no se
-- puede quedar fuera por eso: llega, se baja y hay que guardarlo.
--
-- Así que el material que no está se da de alta con lo único que el archivo dice de él, que es
-- el nombre —`Denominación` en el ZRDN, `Texto breve de material` en el MB51— y queda marcado
-- en `external_source` para que se vea en Productos y Datos Maestros lo complete después.
--
-- Lo que no se inventa: el DUN-14, la estiba y la clase. Sin código de barras se recibe
-- escribiendo el SKU, sin estiba se guarda igual, y la clase se la pone el chequeador en el
-- andén para que el producto no acabe durmiendo con la comida por omisión.
--
-- El corrugado sí hace falta, porque sin él no se puede recibir por cajas. Del nombre sale lo
-- mismo que saca la carga del maestro —«Galleta Chocolate 24s» son 24— y cuando el nombre no
-- lleva número, una caja cuenta como una unidad. Es una cuenta provisional, y por eso el
-- producto queda marcado.
create or replace function producto_de_sap(p_sku text, p_nombre text)
returns uuid
language plpgsql security definer set search_path = public as $f$
declare
  v_id uuid;
  v_sku text := nullif(trim(coalesce(p_sku, '')), '');
  v_nombre text := nullif(trim(coalesce(p_nombre, '')), '');
  v_unidades numeric;
begin
  if v_sku is null then
    return null;
  end if;

  select id into v_id from product where sku = v_sku;
  if found then
    return v_id;
  end if;

  -- Sin nombre no hay con qué darlo de alta: esa fila sí se queda fuera y se cuenta.
  if v_nombre is null then
    return null;
  end if;

  v_unidades := coalesce(
    (regexp_match(v_nombre, '(\d+)\s*[´''’]?[sS]?$'))[1]::numeric,
    1
  );

  insert into product (
    sku, base_code, variant, name, base_uom, status, requires_fefo, external_source
  )
  values (
    v_sku, left(v_sku, 5), nullif(substr(v_sku, 6), ''), v_nombre, 'ST', 'active', true,
    'Llegó en un camión sin estar en el maestro'
  )
  returning id into v_id;

  insert into packaging_level (product_id, code, qty_base_units, is_pick_unit, is_receipt_unit)
  values (v_id, 'UNIT', 1, true, false), (v_id, 'CASE', v_unidades, false, true);

  return v_id;
end;
$f$;

comment on function producto_de_sap(text, text) is
  'El producto del SKU, dándolo de alta con el nombre del archivo si el maestro no lo tiene. '
  'Devuelve null sólo cuando el archivo tampoco trae nombre.';

grant execute on function producto_de_sap to authenticated, service_role;

-- La clase la dice el chequeador ------------------------------------------------------------

-- Sin clase, `grupo_del_producto` lo trata como alimento, que es lo que son 513 de los 690. Un
-- producto recién dado de alta por un camión no tiene ninguna, así que el que lo recibe la
-- elige y queda puesta de una vez: lo que ya está guardado se mueve después reordenando.
--
-- Sólo se pone la que falta. Lo que el maestro ya decidió no lo cambia nadie desde el andén.
create or replace function poner_clase(p_product_id uuid, p_clase contamination_class)
returns void
language plpgsql security definer set search_path = public as $f$
begin
  if not has_role('auxiliar', 'chequeador', 'supervisor', 'admin') then
    raise exception 'No tienes permiso para cambiar un producto';
  end if;
  update product
  set contamination_class = p_clase, updated_at = now()
  where id = p_product_id and contamination_class is null;
end;
$f$;

grant execute on function poner_clase to authenticated;

-- Lo que al camión le falta decir: qué es cada cosa. Mientras no lo diga nadie, el producto se
-- guarda como alimento por omisión, que es lo que son 513 de los 690.
create or replace function productos_sin_clase(p_doc_id uuid)
returns table (product_id uuid, sku text, name text)
language sql stable security definer set search_path = public as $f$
  select p.id, p.sku, p.name
  from product p
  where p.contamination_class is null
    and (
      exists (select 1 from inbound_line l where l.doc_id = p_doc_id and l.product_id = p.id)
      or exists (select 1 from inbound_pallet ip where ip.doc_id = p_doc_id and ip.product_id = p.id)
    )
  order by p.sku;
$f$;

grant execute on function productos_sin_clase to authenticated;

-- El andén necesita saber si el producto trae clase, porque si no la trae la elige el que
-- recibe. Cambia el tipo que devuelve, así que hay que tirarla y volverla a hacer.
drop function if exists producto_para_recibir(text);

create function producto_para_recibir(p_codigo text)
returns table (
  product_id uuid, sku text, name text, requires_fefo boolean, case_id uuid,
  clase contamination_class
)
language plpgsql stable security definer set search_path = public as $f$
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
  select p.id, p.sku, p.name, p.requires_fefo, pl.id, p.contamination_class
  from product p
  left join packaging_level pl on pl.product_id = p.id and pl.code = 'CASE'
  where p.id = v_ids[1];
end;
$f$;

grant execute on function producto_para_recibir to authenticated;

-- Las seis que buscan un ingreso: todas por el mismo resolvedor.

create or replace function buscar_ingreso(p_pedido text)
 RETURNS SETOF inbound_progress
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select * from inbound_progress where id = ingreso_por_codigo(p_pedido);
$function$
;

create or replace function cerrar_ingreso_sin_aviso(p_pedido text)
 RETURNS inbound_doc
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_doc inbound_doc;
begin
  if not has_role('chequeador', 'supervisor', 'admin') then
    raise exception 'No tienes permiso para cerrar un ingreso';
  end if;

  select * into v_doc from inbound_doc where id = ingreso_por_codigo(p_pedido) for update;
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
$function$
;

create or replace function corregir_recibo(p_pedido text, p_pallet_code text, p_cajas numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  select * into v_doc from inbound_doc where id = ingreso_por_codigo(p_pedido);
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

  if exists (select 1 from order_crossdock c where c.lpn_id = v_pal.received_lpn_id) then
    raise exception
      'El pallet % se fue a crossdock: la cantidad se corrige chequeando el camión',
      v_pal.pallet_code;
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
$function$
;

create or replace function recibir_del_documento(p_pedido text, p_pallet_code text, p_dock_location_id uuid, p_barcode text DEFAULT NULL::text, p_max_level smallint DEFAULT NULL::smallint)
 RETURNS TABLE(lpn_code text, to_location_code text, sku text, product_name text, cases numeric, recibidos integer, pallets integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  select * into v_doc from inbound_doc where id = ingreso_por_codigo(p_pedido);
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
$function$
;

create or replace function recibir_mixto(p_pedido text, p_productos jsonb, p_dock_location_id uuid, p_pallet_code text DEFAULT NULL::text, p_max_level smallint DEFAULT NULL::smallint)
 RETURNS TABLE(madre text, lpn_code text, to_location_code text, sku text, product_name text, cases numeric, recibidos integer, pallets integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_doc inbound_doc;
  v_madre lpn;
  v_matricula text;
  v_propia boolean;
  v_item jsonb;
  v_prod record;
  v_res record;
  v_hija text;
  v_lote text;
  v_vence date;
  v_cajas numeric;
  v_linea smallint;
  v_cuenta record;
  v_salida jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Hace falta una sesión para recibir';
  end if;

  if p_productos is null or jsonb_typeof(p_productos) <> 'array'
     or jsonb_array_length(p_productos) < 2 then
    raise exception 'Un pallet mixto lleva al menos dos productos. Si trae uno solo, recíbelo normal';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_productos) e
    group by e->>'codigo', coalesce(e->>'lot', ''), e->>'expiry'
    having count(*) > 1
  ) then
    raise exception 'Ese producto ya está en el pallet con el mismo lote y vencimiento';
  end if;

  select * into v_doc from inbound_doc where id = ingreso_por_codigo(p_pedido) for update;
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

  v_matricula := nullif(trim(coalesce(p_pallet_code, '')), '');
  v_propia := v_matricula is null;
  if v_propia then
    v_matricula := 'WMS-' || lpad(nextval('matricula_wms_seq')::text, 8, '0');
  end if;
  if exists (select 1 from lpn where code = v_matricula) then
    raise exception 'El pallet % ya está en el sistema', v_matricula;
  end if;

  -- La madre no lleva saldo: el producto cuelga de las hijas, una por cada cosa que traía.
  insert into lpn (code, created_by, level, source)
  values (v_matricula, auth.uid(), 'PALLET',
          case when v_propia then 'PROVISIONAL' else 'NEST' end)
  returning * into v_madre;

  for v_item in select * from jsonb_array_elements(p_productos) loop
    v_cajas := nullif(v_item->>'cases', '')::numeric;
    if v_cajas is null or v_cajas <= 0 then
      raise exception 'Escribe cuántas cajas trae cada producto';
    end if;

    v_vence := nullif(v_item->>'expiry', '')::date;
    if v_vence is null then
      raise exception 'Escribe el vencimiento de cada producto: sin él no hay FEFO';
    end if;
    v_lote := nullif(trim(coalesce(v_item->>'lot', '')), '');

    select * into v_prod from producto_para_recibir(v_item->>'codigo');
    if v_prod.case_id is null then
      raise exception 'A % le falta el corrugado en el maestro: no se puede recibir por cajas',
        v_prod.sku;
    end if;

    v_hija := 'WMS-' || lpad(nextval('matricula_wms_seq')::text, 8, '0');

    select * into v_res from receive_pallet(
      v_hija, v_prod.product_id, v_prod.case_id, v_cajas, p_dock_location_id,
      v_lote, v_vence, null, p_max_level
    );

    -- La hija la inventa el WMS, y cuelga de la etiqueta que de verdad venía en el camión.
    update lpn set parent_id = v_madre.id, source = 'PROVISIONAL' where id = v_res.lpn_id;

    select coalesce(max(line_no), 0) + 1 into v_linea from inbound_line where doc_id = v_doc.id;

    insert into inbound_line (doc_id, line_no, product_id, qty_cases, lot, expiry_date)
    values (v_doc.id, v_linea, v_prod.product_id, v_cajas, v_lote, v_vence);

    insert into inbound_pallet (
      doc_id, pallet_code, product_id, qty_cases, lot, expiry_date, received_lpn_id, received_at
    )
    values (
      v_doc.id, v_hija, v_prod.product_id, v_cajas, v_lote, v_vence, v_res.lpn_id, now()
    );

    v_salida := v_salida || jsonb_build_object(
      'lpn_code', v_res.lpn_code,
      'to_location_code', v_res.to_location_code,
      'sku', v_prod.sku,
      'product_name', v_prod.name,
      'cases', v_cajas
    );
  end loop;

  update inbound_doc set status = 'RECEIVING' where id = v_doc.id and status <> 'RECEIVING';

  select count(*)::integer as total, count(received_at)::integer as hechos
  into v_cuenta
  from inbound_pallet where doc_id = v_doc.id;

  return query
  select v_madre.code, x.lpn_code, x.to_location_code, x.sku, x.product_name, x.cases,
         v_cuenta.hechos, v_cuenta.total
  from jsonb_to_recordset(v_salida)
    as x(lpn_code text, to_location_code text, sku text, product_name text, cases numeric);
end;
$function$
;

create or replace function recibir_sin_aviso(p_pedido text, p_codigo text, p_qty_cases numeric, p_dock_location_id uuid, p_lot text DEFAULT NULL::text, p_expiry date DEFAULT NULL::date, p_pallet_code text DEFAULT NULL::text, p_max_level smallint DEFAULT NULL::smallint)
 RETURNS TABLE(lpn_code text, to_location_code text, sku text, product_name text, cases numeric, recibidos integer, pallets integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  select * into v_doc from inbound_doc where id = ingreso_por_codigo(p_pedido) for update;
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
$function$
;
-- Los dos cargadores abren el camión por sus dos llaves -----------------------------------

create or replace function cargar_salidas(p_filas jsonb, p_huellas jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $f$
declare
  v_docs integer := 0;
  v_lineas integer := 0;
  v_sin_producto integer := 0;
  v_juntados integer := 0;
  v_creados integer := 0;
begin
  if not puede_cargar_sap() then
    raise exception 'No tienes permiso para cargar datos de SAP';
  end if;

  create temp table _sal on commit drop as
  select
    f.pedido, nullif(f.entrega, '') as entrega, f.documento, f.material, f.nombre,
    p.id as product_id, f.cantidad, f.centro, f.fecha
  from jsonb_to_recordset(p_filas) as f(
    pedido text, entrega text, documento text, material text, nombre text, cantidad numeric,
    centro text, centro_receptor text, clase text, fecha date
  )
  left join product p on p.sku = f.material
  where f.centro_receptor = (select min(sap_centro) from site);

  -- El camión no se queda fuera por un material que el maestro no tiene: se da de alta con el
  -- nombre que trae el archivo. Sólo queda fuera lo que llega sin nombre y sin maestro.
  select count(distinct material) into v_creados
  from _sal where product_id is null and nullif(trim(coalesce(nombre, '')), '') is not null;

  update _sal s set product_id = producto_de_sap(s.material, s.nombre)
  where s.product_id is null;

  select count(*) into v_sin_producto from _sal where product_id is null;
  delete from _sal where product_id is null or pedido is null or not (cantidad > 0);

  create temp table _doc on commit drop as
  select
    pedido,
    min(entrega) as entrega,
    min(documento) as documento,
    min(centro) as centro,
    min(fecha) as fecha,
    sum(cantidad) as cajas,
    null::uuid as id
  from _sal
  group by pedido;

  -- Gana el que tiene los pallets: ésos llevan lote y vencimiento, y son lo que de verdad
  -- viene en el camión. Si ninguno los tiene, el que esté por pedido, y si no, por entrega.
  update _doc d set id = coalesce(
    (select x.id from inbound_doc x
      where (x.pedido = d.pedido
             or (d.entrega is not null and x.pedido = d.entrega))
        and exists (select 1 from inbound_pallet ip where ip.doc_id = x.id)
      order by x.created_at
      limit 1),
    (select x.id from inbound_doc x where x.pedido = d.pedido),
    (select x.id from inbound_doc x
      where d.entrega is not null and x.pedido = d.entrega
      order by x.created_at
      limit 1)
  )
  -- La base rechaza un `update` sin `where`, aunque la tabla sea temporal y de una fila.
  where d.pedido is not null;

  -- El camión que ya se había abierto dos veces. El sobrante es el que no tiene pallets:
  -- sus líneas se rehacen aquí mismo sobre el bueno, así que no se pierde nada.
  create temp table _dup on commit drop as
  select distinct sobra.id as sobra
  from _doc d
  join inbound_doc sobra
    on sobra.id <> d.id
   and (sobra.pedido = d.pedido
        or (d.entrega is not null and sobra.pedido = d.entrega))
  where d.id is not null
    and sobra.status not in ('CLOSED', 'CANCELLED')
    and not exists (select 1 from inbound_pallet ip where ip.doc_id = sobra.id);

  select count(*) into v_juntados from _dup;
  delete from inbound_line where doc_id in (select sobra from _dup);
  delete from inbound_doc where id in (select sobra from _dup);

  update inbound_doc x set
    pedido = d.pedido,
    entrega = coalesce(x.entrega, d.entrega),
    goods_issue = coalesce(x.goods_issue, d.documento),
    cajas_sap = d.cajas,
    updated_at = now()
  from _doc d
  where x.id = d.id;

  -- `sin_aviso` sólo se decide al nacer. Recibir a ciegas crea pallets, y volver a mirarlos
  -- aquí dejaría encerrado al que ya empezó a descargar.
  insert into inbound_doc (
    pedido, entrega, goods_issue, origin_plant, planned_at, status, cajas_sap, sin_aviso, nota
  )
  select
    d.pedido, d.entrega, d.documento, d.centro, d.fecha, 'ARRIVED', d.cajas, true,
    'SAP anunció este camión sin lista de pallets: se recibe escaneando cada producto.'
  from _doc d
  where d.id is null;

  update _doc d set id = x.id from inbound_doc x where d.id is null and x.pedido = d.pedido;

  select count(*) into v_docs from _doc;

  -- Si el pedido ya vino por el ZRDN, sus líneas traen lote y vencimiento: no se tocan.
  delete from _sal s
  where exists (
    select 1 from _doc d join inbound_pallet ip on ip.doc_id = d.id where d.pedido = s.pedido
  );

  delete from inbound_line
  where doc_id in (select d.id from _doc d join _sal s on s.pedido = d.pedido);

  with lin as (
    select
      d.id as doc_id,
      row_number() over (partition by d.id order by s.material)::smallint as line_no,
      (array_agg(s.product_id))[1] as product_id,
      sum(s.cantidad) as cantidad
    from _sal s
    join _doc d on d.pedido = s.pedido
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
    'documentos', v_docs, 'lineas', v_lineas, 'sin_producto', v_sin_producto,
    'juntados', v_juntados, 'creados', v_creados
  );
end;
$f$;

grant execute on function cargar_salidas to authenticated, service_role;

create or replace function cargar_ingresos(p_filas jsonb, p_huellas jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $f$
declare
  v_docs integer := 0;
  v_pallets integer := 0;
  v_lineas integer := 0;
  v_sin_producto integer := 0;
  v_creados integer := 0;
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
    f.nombre,
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
    pedido text, pallet text, material text, nombre text, cajas numeric, lote text,
    vencimiento date, planta text, fecha date, entrega text, salida text, mix text,
    centro text, a_ciegas boolean
  )
  left join product p on p.sku = f.material;

  -- Lo que va a otro centro no es de esta bodega: en el ZRDN de Snacks son 7 filas que van a
  -- San Pedro Sula. Lo que viene sin destino se queda, que es como vienen las otras plantas.
  delete from _in
  where centro is not null
    and centro not in ((select min(sap_centro) from site), 'Comayagua');

  -- Igual que en el MB51: el material que el maestro no tiene se da de alta con el nombre del
  -- archivo, y sólo se cae lo que llega sin nombre.
  select count(distinct material) into v_creados
  from _in where product_id is null and nullif(trim(coalesce(nombre, '')), '') is not null;

  update _in i set product_id = producto_de_sap(i.material, i.nombre)
  where i.product_id is null;

  select count(*) into v_sin_producto from _in where product_id is null;
  delete from _in where product_id is null or pedido is null or pallet is null or cajas is null;

  create temp table _doc on commit drop as
  select
    pedido,
    min(mix) as mix,
    min(entrega) as entrega,
    min(salida) as salida,
    min(planta) as planta,
    min(fecha) as fecha,
    bool_or(a_ciegas) as a_ciegas,
    null::uuid as id
  from _in
  group by pedido;

  -- El ZRDN de 3010, 3014 y 5006 no trae pedido de traslado y guarda el camión bajo su
  -- entrega: para esas filas el «pedido» es la entrega. Si el MB51 ya abrió ese camión con su
  -- pedido de verdad, es el mismo: se le añaden los pallets al que está, no se abre otro.
  --
  -- Al revés no se junta. Un pedido de verdad trae su propia entrega, y buscar por ella metería
  -- en un mismo camión dos pedidos que sólo comparten el número de entrega.
  update _doc d set id = coalesce(
    (select x.id from inbound_doc x where x.pedido = d.pedido),
    (select x.id from inbound_doc x
      where d.a_ciegas and x.entrega = d.pedido
      order by x.created_at
      limit 1)
  )
  -- La base rechaza un `update` sin `where`, aunque la tabla sea temporal y de una fila.
  where d.pedido is not null;

  update inbound_doc x set
    mix = coalesce(x.mix, d.mix),
    entrega = coalesce(x.entrega, d.entrega),
    goods_issue = coalesce(x.goods_issue, d.salida),
    origin_plant = coalesce(x.origin_plant, d.planta),
    planned_at = coalesce(x.planned_at, d.fecha),
    -- Llegó la lista de pallets: desde aquí se recibe escaneando sus etiquetas.
    sin_aviso = false,
    -- Lo que ya se empezó a recibir no vuelve atrás porque el archivo llegue otra vez.
    status = case
      when x.status in ('RECEIVING', 'CLOSED', 'CANCELLED') then x.status
      when d.salida is null then 'EXPECTED'
      else 'ARRIVED'
    end,
    updated_at = now()
  from _doc d
  where x.id = d.id;

  insert into inbound_doc (
    pedido, mix, entrega, goods_issue, origin_plant, planned_at, status, nota
  )
  select
    d.pedido, d.mix, d.entrega, d.salida, d.planta, d.fecha,
    case when d.salida is null then 'EXPECTED' else 'ARRIVED' end,
    case when d.a_ciegas then 'El reporte de esta planta no trae pedido de traslado.' end
  from _doc d
  where d.id is null;

  update _doc d set id = x.id from inbound_doc x where d.id is null and x.pedido = d.pedido;

  select count(*) into v_docs from _doc;

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
    join _doc d on d.pedido = i.pedido
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

  -- La línea es el resumen de los pallets, así que se arma de los pallets: de dónde vino el
  -- archivo o qué trozo traía deja de importar. Sólo de los documentos que ya tienen pallets;
  -- uno que entró por el MB51 tiene líneas y no tiene pallets, y rehacerlas lo vaciaría.
  create temp table _rehacer on commit drop as
  select distinct d.id
  from _doc d
  where exists (select 1 from inbound_pallet ip where ip.doc_id = d.id);

  delete from inbound_line where doc_id in (select id from _rehacer);

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
    where ip.doc_id in (select id from _rehacer)
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
    'sin_producto', v_sin_producto, 'creados', v_creados
  );
end;
$f$;

grant execute on function cargar_ingresos to authenticated, service_role;

-- Lo que el andén tiene que ver ------------------------------------------------------------

-- `pallets`, `recibidos` y `cajas` siguen siendo las etiquetas, porque es lo que se escanea.
-- Lo nuevo es lo que SAP dice que trae el camión: para el que no tiene lista es lo único que
-- hay, y para el que la tiene es con lo que se compara.
-- Las columnas nuevas van al final: `create or replace view` no deja mover las que ya estaban.
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
  d.origin_plant,
  d.entrega,
  d.cajas_sap,
  (select count(*)::integer from inbound_line l where l.doc_id = d.id) as esperado_lineas,
  (select sum(l.qty_cases) from inbound_line l where l.doc_id = d.id) as esperado_cajas
from inbound_doc d
left join inbound_pallet p on p.doc_id = d.id
group by d.id;

-- Y que se vean en Productos ----------------------------------------------------------------

-- Lo que entró por un camión no tiene DUN-14, ni estiba, ni clase hasta que alguien la pone.
-- La columna nueva va al final porque `create or replace view` no deja mover las que ya están.
create or replace view product_readiness as
  select
    p.id, p.sku, p.name, p.base_code, p.variant, p.sector, p.units_label, p.status,
    (
      select b.code from barcode b
      join packaging_level pl on pl.id = b.packaging_level_id
      where pl.product_id = p.id and pl.code = 'CASE' and b.is_primary
      limit 1
    ) as dun,
    (
      select bt.name from packaging_level pl
      join box_type bt on bt.code = pl.box_type_code
      where pl.product_id = p.id and pl.code = 'CASE'
      limit 1
    ) as tipo_caja,
    (
      select pl.qty_base_units from packaging_level pl
      where pl.product_id = p.id and pl.code = 'CASE'
      limit 1
    ) as por_caja,
    (
      select pc.cases_per_pallet from pallet_config pc
      where pc.product_id = p.id and pc.is_default
      limit 1
    ) as cajas_por_pallet,
    p.contamination_class is not null as tiene_clase,
    exists (
      select 1 from packaging_level pl
      where pl.product_id = p.id and pl.code = 'CASE'
        and pl.length_mm is not null and pl.width_mm is not null
        and pl.height_mm is not null and pl.gross_weight_g is not null
    ) as tiene_corrugado,
    exists (select 1 from pallet_config pc where pc.product_id = p.id) as tiene_estiba,
    exists (
      select 1 from barcode b
      join packaging_level pl on pl.id = b.packaging_level_id
      where pl.product_id = p.id and b.is_primary
    ) as tiene_codigo,
    not exists (
      select 1 from barcode b
      join packaging_level pl on pl.id = b.packaging_level_id
      join barcode_conflict bc on bc.code = b.code
      where pl.product_id = p.id
    ) as codigo_sin_conflicto,
    (
      select count(*) from barcode b
      join packaging_level pl on pl.id = b.packaging_level_id
      join barcode b2 on b2.code = b.code
      join packaging_level pl2 on pl2.id = b2.packaging_level_id
      where pl.product_id = p.id and pl2.product_id <> p.id
    ) > 0 as codigo_compartido,
    p.external_source = 'Llegó en un camión sin estar en el maestro' as sin_maestro
  from product p;

-- Reparar lo que dejó la carga de hoy -------------------------------------------------------

-- Los documentos que el MB51 abrió antes de esto nacieron con la lista vacía y `sin_aviso` en
-- falso: nadie los puede recibir. Los que todavía no tienen ningún pallet pasan a sin aviso.
update inbound_doc d
set sin_aviso = true, updated_at = now()
where not d.sin_aviso
  and d.status not in ('CLOSED', 'CANCELLED')
  and d.origin_plant ~ '^[0-9]{4}$'
  and not exists (select 1 from inbound_pallet ip where ip.doc_id = d.id);

-- Y las huellas del MB51 se borran para que la próxima subida vuelva a mandar los documentos y
-- junte los camiones partidos. Sin esto el archivo no cambió, no se manda, y nada se arregla.
delete from carga_huella where kind = 'SALIDAS';
