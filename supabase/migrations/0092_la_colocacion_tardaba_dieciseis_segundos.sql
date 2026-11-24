-- La colocación tardaba dieciséis segundos
--
-- `suggest_putaway_location` es la que corre cada vez que alguien escanea un pallet para
-- guardarlo, en `/guardar` y en la carga inicial. Medido con `explain analyze` el 24/11/2026
-- sobre la bodega vacía, una sola llamada:
--
--   Execution Time: 16053.973 ms
--
-- La misma consulta sin las dos subconsultas de exclusividad de carril: **185.936 ms**. El 99%
-- del tiempo estaba en ellas.
--
-- Por qué: las dos preguntan «¿este carril ya tiene otro producto?», y estaban escritas como
-- `not exists` correlacionados con `l.lane_id`. Postgres los evalúa **una vez por cada posición
-- candidata** —4,774 en bodega vacía— y cada evaluación vuelve a recorrer `stock` y `location`.
-- Pero la pregunta es **del carril**, no de la posición, y carriles hay 205. Se calcula una vez,
-- agrupando por `lane_id`, y se consulta contra eso.
--
-- `materialized` no es decorativo: sin él Postgres mete la CTE dentro de la consulta y vuelve a
-- dejarla correlacionada, que es justo el problema que se está arreglando.
--
-- La regla no cambia: un carril sigue sin mezclar dos productos o dos lotes, y lo que otro lleva
-- en camino sigue contando igual que lo que ya está. Esto es la misma respuesta, más rápido.

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
  clase as (select clase_abc(p_product_id) as c),
  -- Los carriles que ya tienen dueño: otro producto, u otro lote del mismo.
  ajeno as materialized (
    select distinct ol.lane_id
    from stock otro
    join location ol on ol.id = otro.location_id
    where otro.qty_base > 0
      and (otro.product_id <> p_product_id or otro.lot is distinct from p_lot)
  ),
  -- Y los que alguien va a estrenar con otra cosa: lo que viene en camino cuenta igual.
  en_camino as materialized (
    select distinct ol.lane_id
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
    and not exists (select 1 from ajeno where ajeno.lane_id = l.lane_id)
    and not exists (select 1 from en_camino where en_camino.lane_id = l.lane_id)
  order by
    (s.product_id is not null) desc,
    coalesce(l.level, 0),
    l.pick_sequence * case when clase.c = 'C' then -1 else 1 end nulls last,
    l.code
  limit 1;
$f$;

-- `clase_abc` cuesta 3 ms y la colocación la llama una vez, pero el orden de recorrido de la
-- carga inicial la llamaba **por cada posición candidata** y ahí sí dolía. No hay nada que
-- cambiar en la función; queda dicho para que no se repita el patrón.
comment on function clase_abc(uuid) is
  'Clase ABC del producto, del pronóstico. Cuesta unos 3 ms: llamarla dentro de un order by '
  'que recorre posiciones la ejecuta una vez por fila. Sacarla a una CTE.';
