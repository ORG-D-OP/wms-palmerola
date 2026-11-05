/**
 * El maestro trajo el peso bruto del corrugado y las cajas por pallet, y de ahi sale algo
 * que no se sabia: hay estibas de 1,955 kg. 31 productos pasan de 1,200 kg y 8 pasan de
 * 1,300 —casi todos detergentes de Cuidado del Hogar, mas un aceite—, asi que si la
 * capacidad del rack es la que se cree, esos pallets no pueden ir arriba.
 *
 * El motor ya respeta el limite; el limite no esta puesto. `location.max_weight_kg` nulo
 * significa «sin limite conocido», que es la verdad de hoy. En cuanto el Ing. Alfredo
 * confirme la capacidad, es una fila de `zone_spec` y volver a generar.
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

/** Que productos no caben en cada zona con el limite que tenga puesto hoy. */
create view estiba_vs_capacidad as
  select
    z.code as zona,
    z.kind,
    s.max_weight_kg as limite_kg,
    count(*) filter (where pc.total_weight_kg > s.max_weight_kg)::integer as no_caben,
    count(*)::integer as productos,
    round(max(pc.total_weight_kg))::integer as estiba_mas_pesada_kg
  from zone z
  join zone_spec s on s.zone_id = z.id
  cross join pallet_config pc
  where pc.is_default and s.max_weight_kg is not null
  group by z.code, z.kind, s.max_weight_kg;

grant select on estiba_vs_capacidad to authenticated;
