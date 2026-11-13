/**
 * «Está vacía, y caben 50 cajas» de una posición que tenía producto.
 *
 * El aviso de reabastecimiento se cuelga de los renglones de existencia de cada posición, y
 * un renglón en **cero** es lo que dice «esta posición es de este producto». Eso está bien
 * —una posición que se vació tiene que seguir saliendo en la lista—, pero si mientras tanto
 * alguien dejó **otro** producto ahí, la lista manda un viaje que el propio sistema rechaza al
 * escanear el destino: la posición no está vacía, la tiene otro.
 *
 * Así que la lista lo dice. Sigue saliendo, porque el picking de ese producto de verdad está en
 * cero y el jefe tiene que saberlo, pero en vez de prometer un hueco nombra al que lo está
 * ocupando, que es lo que hay que resolver primero.
 */
create or replace view picking_bajo as
with slot as (
  select
    l.code as posicion,
    min(l.pick_sequence) as pick_sequence,
    min(a.replenish_pct) as replenish_pct,
    s.product_id,
    greatest(
      sum(
        case
          when vence_demasiado_pronto(s.expiry_date) then 0
          else s.qty_base - s.qty_allocated
        end
      ),
      0
    ) as disponible
  from stock s
  join location l on l.id = s.location_id
  join location_area la on la.location_id = l.id and la.valid_to is null
  join area a on a.id = la.area_id and a.type_code = 'PICKING' and a.is_active
  where l.retired_at is null
  group by l.code, s.product_id
),
con_tope as (
  select
    slot.*,
    p.sku,
    p.name as producto,
    coalesce(pl.qty_base_units, 1) as por_caja,
    coalesce(pc.cases_per_pallet, 0) * coalesce(pl.qty_base_units, 1) as tope
  from slot
  join product p on p.id = slot.product_id
  left join packaging_level pl on pl.product_id = slot.product_id and pl.code = 'CASE'
  left join pallet_config pc on pc.product_id = slot.product_id and pc.is_default
)
select
  t.posicion,
  t.sku,
  t.producto,
  t.disponible,
  t.tope,
  t.por_caja,
  t.replenish_pct,
  floor(t.disponible / t.tope * 100)::int as pct,
  o.posicion as sacar_de,
  o.expiry_date as vence_origen,
  ocupa.producto as ocupada_por
from con_tope t
left join lateral (
  -- De dónde sacarlo: el pallet del mismo producto que primero vence, como manda FEFO, de los
  -- que todavía pueden salir.
  select l2.code as posicion, s2.expiry_date
  from stock s2
  join location l2 on l2.id = s2.location_id
  join location_area la2 on la2.location_id = l2.id and la2.valid_to is null
  join area a2 on a2.id = la2.area_id and a2.type_code = 'ALMACEN' and a2.is_active
  where s2.product_id = t.product_id
    and s2.qty_base - s2.qty_allocated > 0
    and l2.retired_at is null
    and not vence_demasiado_pronto(s2.expiry_date)
  order by s2.expiry_date nulls last, l2.code
  limit 1
) o on true
left join lateral (
  -- Y quién la está ocupando, si es otro. El que más tenga, que es el que hay que mover.
  select p3.name as producto
  from stock s3
  join location l3 on l3.id = s3.location_id
  join product p3 on p3.id = s3.product_id
  where l3.code = t.posicion
    and s3.product_id <> t.product_id
    and s3.qty_base > 0
  order by s3.qty_base desc, p3.name
  limit 1
) ocupa on true
where t.tope > 0
  and t.disponible < t.tope * t.replenish_pct / 100.0
order by floor(t.disponible / t.tope * 100), t.pick_sequence nulls last, t.posicion;

grant select on picking_bajo to authenticated;
