/**
 * El hueco sugerido no miraba lo que otro ya tiene apartado, y mandaba a dos personas al mismo
 * carril con productos distintos.
 *
 * `complete_putaway` no deja meter otro producto o lote en un carril ocupado: ésa es la regla
 * de la bodega. Pero `suggest_putaway_location` sólo miraba el **saldo** del carril, no lo
 * **apartado**, y lo apartado es justamente el pallet que va en camino y todavía no llegó. Así
 * que mandaba al segundo a un hueco donde al llegar le iban a decir que no.
 *
 * Encontrado probando el pallet mixto en producción: sus dos piezas salieron a F3-020-01 y
 * F3-020-02 —el mismo carril— y la segunda rebotó. Pero no es cosa de los mixtos: pasa igual
 * con **dos personas recibiendo a la vez** productos distintos, que es lo normal un día de
 * camiones.
 *
 * El arreglo es mirar también las posiciones apartadas por una tarea que sigue viva. Una tarea
 * cerrada ya dejó su saldo, y el saldo ya lo miraba la regla de antes.
 */
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
    and not exists (
      select 1 from stock otro
      join location ol on ol.id = otro.location_id
      where ol.lane_id = l.lane_id and otro.qty_base > 0
        and (otro.product_id <> p_product_id or otro.lot is distinct from p_lot)
    )
    and not exists (
      -- Lo que otro lleva en camino a ese carril cuenta igual que lo que ya está ahí.
      select 1 from location ol
      join task t on t.id = ol.reserved_by_task_id
      where ol.lane_id = l.lane_id
        and t.status not in ('DONE', 'CANCELLED')
        and (t.product_id is distinct from p_product_id or t.lot is distinct from p_lot)
    )
  order by
    (s.product_id is not null) desc,
    coalesce(l.level, 0),
    l.pick_sequence nulls last,
    l.code
  limit 1;
$f$;
