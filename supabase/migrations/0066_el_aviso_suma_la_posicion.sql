/**
 * Dos cosas que el aviso de la 0065 contaba mal, encontradas probándolo contra la base real.
 *
 * La primera: miraba **cada saldo por separado**. Una posición de picking puede tener dos
 * saldos del mismo producto —el resto del lote viejo y el pallet que acaban de bajar—, porque
 * `stock` es único por posición, producto, matrícula, lote y vencimiento. Así que al
 * reabastecerla de verdad, con otro pallet, el saldo viejo seguía saliendo en el aviso como si
 * la posición estuviera en nada. Lo que importa es **cuánto hay en la posición**, sumado.
 *
 * La segunda: exigía `qty_base > 0`, y cuando una posición se vacía del todo el saldo se queda
 * en cero en vez de desaparecer. O sea que la posición salía del aviso **justo en el peor
 * momento**. Ahora el cero sale, y sale primero.
 *
 * Lo que la vista no puede saber todavía es que una posición de picking *debería* tener un
 * producto cuando no tiene ninguno: eso es asignación de huecos y no está en el modelo. Una
 * posición que se queda sin saldo ninguno es invisible aquí.
 */
-- La vista cambia de columnas, y `create or replace` no sabe quitar ninguna.
drop view if exists picking_bajo;

create view picking_bajo as
with slot as (
  select
    l.code as posicion,
    min(l.pick_sequence) as pick_sequence,
    min(a.replenish_pct) as replenish_pct,
    s.product_id,
    greatest(sum(s.qty_base - s.qty_allocated), 0) as disponible
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
  o.expiry_date as vence_origen
from con_tope t
left join lateral (
  -- De dónde sacarlo: el pallet del mismo producto que primero vence, como manda FEFO.
  select l2.code as posicion, s2.expiry_date
  from stock s2
  join location l2 on l2.id = s2.location_id
  join location_area la2 on la2.location_id = l2.id and la2.valid_to is null
  join area a2 on a2.id = la2.area_id and a2.type_code = 'ALMACEN' and a2.is_active
  where s2.product_id = t.product_id
    and s2.qty_base - s2.qty_allocated > 0
    and l2.retired_at is null
  order by s2.expiry_date nulls last, l2.code
  limit 1
) o on true
where t.tope > 0
  and t.disponible < t.tope * t.replenish_pct / 100.0
order by floor(t.disponible / t.tope * 100), t.pick_sequence nulls last, t.posicion;

grant select on picking_bajo to authenticated;
