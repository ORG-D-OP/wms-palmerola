/**
 * Nadie cuenta 0.18 bolsas.
 *
 * Las pantallas llevan meses escribiendo unidades partidas: «faltan 3 cajas y 4.956 sueltas»,
 * «le quedan 1.974 sueltas de 64 cajas». No es un error de la pantalla: el número está
 * partido en la base, y viene del archivo de SAP. SAP cuenta en cajas con tres decimales
 * —636.415 CA de un producto de 24 unidades— y al multiplicar por las 24 unidades de la caja
 * queda un 15,273.96 que se arrastra a cada pallet y a cada movimiento.
 *
 * De dónde saca SAP ese .415 no lo sabemos y no se inventa aquí: 15,274 unidades en cajas
 * darían 636.417, no 636.415. Lo que sí sabemos es que nuestro sistema cuenta en **unidades
 * enteras**, porque media bolsa no existe, así que la conversión redondea al entrar —las dos
 * puertas por donde entra: la foto del inventario y las líneas de los camiones de despacho—
 * y `texto_cajas` redondea al salir, para que ninguna pantalla imprima un pedazo de unidad.
 *
 * Lo que ya está escrito no se toca: son centésimas de unidad en 252 renglones de existencia
 * que nacieron en la carga inicial, y reescribir existencia sembrada por un decimal es un
 * riesgo mayor que el decimal. Se van solos cuando la bodega arranque de cero.
 */

/** La misma cuenta que `desglose` en `lib/cajas.ts`, y las dos redondean a unidad entera. */
create or replace function texto_cajas(p_qty numeric, p_por_caja numeric) returns text
language sql immutable set search_path = public as $$
  with d as (
    select floor(round(p_qty) / p_por_caja) as cajas, mod(round(p_qty), p_por_caja) as sueltas
  ),
  t as (
    select
      trim_scale(cajas) || case when cajas = 1 then ' caja' else ' cajas' end as en_cajas,
      trim_scale(sueltas) || case when sueltas = 1 then ' suelta' else ' sueltas' end as en_sueltas,
      cajas, sueltas
    from d
  )
  select case
    when cajas = 0 then en_sueltas
    when sueltas = 0 then en_cajas
    else en_cajas || ' y ' || en_sueltas
  end
  from t;
$$;

create or replace function cargar_despachos(p_filas jsonb, p_huellas jsonb default '{}'::jsonb)
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
    round(f.cantidad * case f.um
      when 'CA' then coalesce(pl.qty_base_units, 1)
      when 'DOC' then 12
      else 1
    end) as qty_base,
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
      round(libre * por_caja), round(pendiente * por_caja),
      round(bloqueado * por_caja), round(transito * por_caja)
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

grant execute on function cargar_despachos(jsonb, jsonb) to authenticated;
grant execute on function cargar_inventario_sap(jsonb, date) to authenticated;
