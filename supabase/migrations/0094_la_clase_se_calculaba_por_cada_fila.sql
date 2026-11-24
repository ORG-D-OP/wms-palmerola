-- La clase ABC se calculaba una vez por fila
--
-- La 0092 sacó `clase_abc` del `order by` a una CTE y dejó escrito el porqué: la función cuesta
-- unos 3 ms y dentro de un orden que recorre posiciones se ejecuta una vez por fila. La CTE no
-- bastó. Postgres **mete dentro** una CTE de una sola fila sin efectos, así que `clase_abc`
-- volvía al `order by` y se evaluaba en cada comparación del sort.
--
-- No se notó hasta hoy porque con el carril viejo —la corrida entera del rack— la bodega llena
-- no dejaba ninguna posición candidata: el sort ordenaba cero filas. Con el carril de la 0093
-- sobreviven unas mil, y ahí aparece.
--
-- Medido el 24/11/2026 sobre la bodega con la existencia del 14/11 (4,725 pallets), una sola
-- llamada:
--
--   clase as (...)               3,633 ms
--   clase as materialized (...)    187 ms
--
-- Diecinueve veces. `materialized` es lo mismo que hizo falta en la 0092 para las dos CTE de
-- exclusividad, por la misma razón y con el mismo descuido: la palabra no es decorativa.
--
-- La respuesta no cambia. Es la misma consulta de la 0093 con una palabra.

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
  clase as materialized (select clase_abc(p_product_id) as c),
  ajeno as materialized (
    select distinct ol.carril
    from stock otro
    join location ol on ol.id = otro.location_id
    where otro.qty_base > 0
      and (otro.product_id <> p_product_id or otro.lot is distinct from p_lot)
  ),
  en_camino as materialized (
    select distinct ol.carril
    from location ol
    join task t on t.id = ol.reserved_by_task_id
    where t.status not in ('DONE', 'CANCELLED')
      and (t.product_id is distinct from p_product_id or t.lot is distinct from p_lot)
  )
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
    and not exists (select 1 from ajeno where ajeno.carril = l.carril)
    and not exists (select 1 from en_camino where en_camino.carril = l.carril)
  order by
    (s.product_id is not null) desc,
    coalesce(l.level, 0),
    l.pick_sequence * case when clase.c = 'C' then -1 else 1 end nulls last,
    l.code
  limit 1;
$f$;

comment on function clase_abc(uuid) is
  'Clase ABC del producto, del pronóstico. Cuesta unos 3 ms. Dentro de un order by que recorre '
  'posiciones se ejecuta una vez por comparación, y sacarla a una CTE no basta: la CTE hay que '
  'declararla materialized o Postgres la mete dentro otra vez.';
