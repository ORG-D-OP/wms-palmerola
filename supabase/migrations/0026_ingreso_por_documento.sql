/**
 * Recibir deja de ser teclear. El operario teclea el `Pedido` una vez por camion —ocho
 * digitos impresos en la misma hoja que trae la lista de productos— y de ahi en adelante
 * solo escanea la etiqueta que el pallet ya trae de planta.
 *
 * El documento sabe, por pallet, el material, el lote, el vencimiento y la cantidad. Eso
 * elimina las cuatro digitaciones por pallet, que para un camion de 30 pallets eran 120
 * oportunidades de error en los dos datos que el operario no puede verificar.
 */
create view inbound_progress as
  select
    d.id,
    d.pedido,
    d.status,
    d.planned_at,
    count(p.id)::integer as pallets,
    count(p.received_at)::integer as recibidos,
    count(distinct p.product_id)::integer as materiales,
    sum(p.qty_cases) as cajas
  from inbound_doc d
  left join inbound_pallet p on p.doc_id = d.id
  group by d.id, d.pedido, d.status, d.planned_at;

grant select on inbound_progress to authenticated;

/** Lo que el documento espera, con lo que ya se recibio marcado. Es la lista de la hoja. */
create view inbound_detail as
  select
    p.id,
    p.doc_id,
    d.pedido,
    p.pallet_code,
    p.qty_cases,
    p.lot,
    p.expiry_date,
    p.received_at,
    p.received_lpn_id,
    pr.id as product_id,
    pr.sku,
    pr.name,
    pr.base_code,
    bt.name as tipo_caja
  from inbound_pallet p
  join inbound_doc d on d.id = p.doc_id
  join product pr on pr.id = p.product_id
  left join packaging_level pl on pl.product_id = pr.id and pl.code = 'CASE'
  left join box_type bt on bt.code = pl.box_type_code;

grant select on inbound_detail to authenticated;

/**
 * Recibe un pallet del documento. El codigo de caja es opcional y sirve de confirmacion:
 * se compara contra el producto base, porque el DUN-14 no distingue variantes —61244.4,
 * 61244C4 y 61244P4 comparten codigo— y eso no se puede arreglar escaneando.
 */
create function recibir_del_documento(
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

  select * into v_doc from inbound_doc where pedido = trim(p_pedido);
  if not found then
    raise exception 'No hay ningún ingreso con el pedido %', trim(p_pedido);
  end if;

  select * into v_pal from inbound_pallet
  where doc_id = v_doc.id and pallet_code = trim(p_pallet_code);
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

grant execute on function recibir_del_documento to authenticated;
