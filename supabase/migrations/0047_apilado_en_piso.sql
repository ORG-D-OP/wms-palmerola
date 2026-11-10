/**
 * Cuantos pallets de un producto se pueden poner uno encima de otro en el piso.
 *
 * La bodega lo tiene medido producto por producto y no se deduce de la caja: las latas
 * aguantan tres niveles y el tetra de la misma familia aguanta dos. Lo que no esta en esa
 * lista va a un solo nivel, que es lo seguro cuando nadie lo ha probado.
 *
 * El dato ya tenia donde vivir —`pallet_config.allows_stacking` y `max_stack`, de 0006— y
 * estaba vacio. Esto lo llena y, sobre todo, hace que el motor de ubicacion lo respete:
 * hasta hoy podia mandar un pallet encima de otro sin preguntarle a nadie.
 *
 * Solo aplica al piso. Una posicion de rack es para un pallet: lo que la limita es la
 * altura del nivel, no la estiba.
 */

/**
 * Cuantos pallets caben todavia encima de lo que hay en una posicion.
 *
 * En el piso manda el producto, acotado por lo que aguante el lugar si alguien lo midio.
 * En rack el tope es uno y no se discute.
 */
create function pallets_que_caben(p_location_id uuid, p_product_id uuid)
returns integer
language sql stable security definer set search_path = public as $$
  select greatest(
    coalesce(
      case
        when l.kind <> 'floor_stack' then 1
        else least(
          coalesce((
            select case when pc.allows_stacking then coalesce(pc.max_stack, 1) else 1 end
            from pallet_config pc
            where pc.product_id = p_product_id and pc.is_default
          ), 1),
          coalesce(l.max_pallets_stacked, 10)
        )
      end,
      1
    ) - (
      select count(distinct st.lpn_id)
      from stock st
      where st.location_id = l.id and st.qty_base > 0
    ),
    0
  )::integer
  from location l
  where l.id = p_location_id;
$$;

grant execute on function pallets_que_caben(uuid, uuid) to authenticated;

/**
 * Misma eleccion de siempre, con una regla mas: a una posicion que ya tiene pallets solo se
 * le sube otro si el producto aguanta esa altura. Antes nada lo impedia.
 */
create or replace function suggest_putaway_location(
  p_product_id uuid,
  p_lot text default null,
  p_expiry date default null,
  p_max_level smallint default null
) returns uuid
language sql stable security definer set search_path = public as $$
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
  order by
    (s.product_id is not null) desc,
    coalesce(l.level, 0),
    l.pick_sequence nulls last,
    l.code
  limit 1;
$$;

/** Lo que la bodega apila hoy, para verlo de un vistazo sin armar el join. */
create view apilado_en_piso as
  select p.sku, p.name, pc.cases_per_pallet, pc.max_stack as niveles
  from product p
  join pallet_config pc on pc.product_id = p.id and pc.is_default
  where pc.allows_stacking;

grant select on apilado_en_piso to authenticated;
