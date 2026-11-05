/**
 * El alcance del montacargas de rack venia sembrado en 4, y el rack de abarrotes tiene 6
 * niveles: con eso, los niveles 5 y 6 quedaban fuera del alcance de todo el mundo y sus
 * 192 posiciones no se podian usar. Se toma del almacen, que es el dato.
 */
update equipment_type
set max_level = (select max(level) from location where level is not null)
where code = 'MONTACARGA_RACK';

comment on column equipment_type.max_level is
  'Hasta que nivel alcanza. El de rack sale del nivel mas alto que existe en el almacen. '
  'Los de piso estan en 0; si el primer nivel del rack se alcanza desde el piso, es un '
  'update de una fila.';

-- ---------------------------------------------------------------------------------------
-- El pedido, como viene impreso
-- ---------------------------------------------------------------------------------------

/**
 * El archivo trae «0060211130» y el papel dice «60211130». El operario teclea lo que ve,
 * asi que la busqueda ignora los ceros de la izquierda por los dos lados.
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
language plpgsql security definer set search_path = public as $$
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
  set received_lpn_id = v_res.lpn_id, received_at = now()
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
$$;

/** Busca un documento por el pedido impreso, con o sin ceros a la izquierda. */
create function buscar_ingreso(p_pedido text)
returns setof inbound_progress
language sql stable set search_path = public as $$
  select * from inbound_progress
  where ltrim(pedido, '0') = ltrim(trim(p_pedido), '0');
$$;

grant execute on function buscar_ingreso to authenticated;

-- ---------------------------------------------------------------------------------------
-- Consultar el inventario: la pregunta de todos los dias
-- ---------------------------------------------------------------------------------------

/**
 * Donde esta cada cosa y cuanto hay, en cajas y sueltas. No habia ninguna pantalla capaz
 * de contestar «donde esta el SKU X» ni «que hay en la posicion Y», que es lo que mas se
 * pregunta en una bodega.
 */
create view inventario as
  select
    s.id,
    p.id as product_id,
    p.sku,
    p.name,
    p.base_code,
    s.lot,
    s.expiry_date,
    s.qty_base,
    s.qty_allocated,
    s.qty_base - s.qty_allocated as disponible,
    d.cajas,
    d.sueltas,
    d.por_caja,
    l.id as location_id,
    l.code as location_code,
    coalesce(l.level, 0) as level,
    z.code as zone_code,
    z.kind as zone_kind,
    a.code as area_code,
    a.name as area_name,
    lp.code as lpn_code,
    lp.id as lpn_id
  from stock s
  join product p on p.id = s.product_id
  join location l on l.id = s.location_id
  join lane la on la.id = l.lane_id
  join zone z on z.id = la.zone_id
  left join location_area lar on lar.location_id = l.id and lar.valid_to is null
  left join area a on a.id = lar.area_id
  left join lpn lp on lp.id = s.lpn_id
  cross join lateral desglose(p.id, s.qty_base) d
  where s.qty_base > 0;

grant select on inventario to authenticated;

/** Lo que hay de un producto en todo el almacen, en orden de salida (FEFO). */
create function existencia_de(p_texto text)
returns setof inventario
language sql stable set search_path = public as $$
  select * from inventario
  where sku = trim(p_texto)
     or base_code = trim(p_texto)
     or lpn_code = upper(trim(p_texto))
     or location_code = upper(trim(p_texto))
     or product_id in (
       select pl.product_id from barcode b
       join packaging_level pl on pl.id = b.packaging_level_id
       where b.code = trim(p_texto)
     )
  order by expiry_date nulls last, location_code;
$$;

grant execute on function existencia_de to authenticated;

-- ---------------------------------------------------------------------------------------
-- Ocupacion por area y la cara del rack
-- ---------------------------------------------------------------------------------------

create view area_occupancy as
  select
    a.code,
    a.name,
    tp.is_virtual,
    count(l.id)::integer as total,
    count(l.id) filter (
      where exists (select 1 from stock s where s.location_id = l.id and s.qty_base > 0)
    )::integer as ocupadas
  from area a
  join area_type tp on tp.code = a.type_code
  left join location_area lar on lar.area_id = a.id and lar.valid_to is null
  left join location l on l.id = lar.location_id and l.retired_at is null
  where a.is_active
  group by a.code, a.name, tp.is_virtual;

grant select on area_occupancy to authenticated;

/**
 * La cara del rack: una fila por posicion con su bahia, su nivel y su profundidad, y lo
 * que tiene dentro. La vista de planta no muestra niveles, asi que sin esto no habia forma
 * de ver el rack como lo ve el montacarguista cuando llega al pasillo.
 */
create view rack_elevacion as
  select
    z.code as zone_code,
    la.code as lane_code,
    (regexp_match(l.code, '-B(\d+)-'))[1]::integer as bahia,
    coalesce(l.level, 0) as nivel,
    l.depth_index as fondo,
    l.code,
    l.status,
    l.usage_code,
    l.reserved_by_task_id is not null as apartada,
    s.product_id,
    p.sku,
    p.name,
    s.lot,
    s.expiry_date,
    s.qty_base,
    lp.code as lpn_code
  from location l
  join lane la on la.id = l.lane_id
  join zone z on z.id = la.zone_id
  left join stock s on s.location_id = l.id and s.qty_base > 0
  left join product p on p.id = s.product_id
  left join lpn lp on lp.id = s.lpn_id
  where z.kind = 'rack' and l.retired_at is null;

grant select on rack_elevacion to authenticated;
