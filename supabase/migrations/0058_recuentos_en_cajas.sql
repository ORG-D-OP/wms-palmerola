-- La pantalla del jefe pintaba la diferencia en unidades base: un recuento que bajo de 120 a
-- 100 cajas salia como «-480», que no es el idioma de la bodega. La vista aprende a decir
-- cuantas unidades trae la caja y la pantalla divide.
--
-- `create or replace view` solo deja anadir columnas al final, asi que va al final.
create or replace view recuentos as
  select
    c.id,
    c.counted_at,
    p.full_name as persona,
    l.code as posicion,
    lp.code as pallet,
    pr.sku,
    pr.name as producto,
    c.lot,
    c.expiry_date,
    c.qty_expected,
    c.qty_found,
    c.qty_found - c.qty_expected as diferencia,
    c.task_id,
    c.note,
    coalesce(
      (
        select pl.qty_base_units from packaging_level pl
        where pl.product_id = c.product_id and pl.code = 'CASE'
      ),
      1
    ) as por_caja
  from stock_count c
  join location l on l.id = c.location_id
  join product pr on pr.id = c.product_id
  left join lpn lp on lp.id = c.lpn_id
  left join profile p on p.id = c.counted_by;
