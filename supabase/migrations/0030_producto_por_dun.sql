/**
 * El DUN-14 es la llave de trabajo del producto: es lo que esta impreso en la caja, lo que
 * se escanea al recibir y al surtir, y con lo que la gente va a buscar en el sistema. Por
 * eso vive en la vista de productos y no hay que armar un join para llegar a el.
 *
 * Se trae tambien el tipo de caja: cuando dos variantes comparten el DUN-14 —61244C4 de
 * carton y 61244P4 de plastico son el mismo DUN— lo unico que las distingue a la vista es
 * el corrugado, asi que es lo que hay que preguntarle al operario.
 */
drop view product_readiness;

create view product_readiness as
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
    ) > 0 as codigo_compartido
  from product p;

grant select on product_readiness to authenticated;
