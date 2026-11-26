/**
 * El mapa no sabía que en el piso se apila.
 *
 * Un cuadro de rack lleva su pila dibujada: seis niveles son seis cajas y el tono dice
 * cuántas están ocupadas. El piso no tiene estantería, así que el mapa pintaba un pallet
 * donde hay tres y una posición con uno se veía igual de llena que una con los tres. El dato
 * existe desde la 0047 —`pallet_config.allows_stacking` y `max_stack`, que la bodega midió
 * producto por producto— y nadie lo estaba mirando.
 *
 * Y al tocar un cuadro apartado por una tarea, el panel decía «libre». No lo está: está
 * guardada para alguien que va en camino, que es justo lo que uno necesita saber antes de
 * mandar otro pallet ahí. `que_hay_en` no devolvía ni la reserva ni si la posición guarda
 * producto, así que la pantalla no tenía con qué distinguirlo de un hueco vacío.
 */

create or replace function planta()
returns jsonb
language sql
stable
security invoker
set search_path = public as $f$
  with pos as (
    select
      l.code,
      regexp_replace(l.code, '-N\d+-', '-') as cuadro,
      l.grupo,
      a.code as area,
      coalesce(u.holds_product, true) as guarda,
      (e.location_id is not null) as con_producto,
      (l.reserved_by_task_id is not null) as apartada
    from location l
    join lane la on la.id = l.lane_id
    join zone z on z.id = la.zone_id
    join location_usage u on u.code = l.usage_code
    left join location_area lar on lar.location_id = l.id and lar.valid_to is null
    left join area a on a.id = lar.area_id
    left join (select distinct location_id from stock where qty_base > 0) e
      on e.location_id = l.id
    where l.retired_at is null and z.kind in ('floor', 'rack')
  ),
  /*
    Cuántos pallets hay encima de cada posición de piso y cuántos le caben. El tope sale del
    producto que está puesto ahí —si hay varios, manda el más delicado— acotado por lo que
    aguante el lugar si alguien lo midió, que es la misma regla de `pallets_que_caben`.
  */
  pila as (
    select
      l.code,
      count(distinct coalesce(s.lpn_id::text, s.id::text)) as hay,
      least(
        min(case when pc.allows_stacking then coalesce(pc.max_stack, 1) else 1 end),
        coalesce(l.max_pallets_stacked, 10)
      ) as caben
    from location l
    join stock s on s.location_id = l.id and s.qty_base > 0
    left join pallet_config pc on pc.product_id = s.product_id and pc.is_default
    where l.retired_at is null and l.kind = 'floor_stack'
    group by l.id, l.code, l.max_pallets_stacked
  )
  select jsonb_build_object(
    'ocupadas', (
      select coalesce(jsonb_agg(code order by code), '[]'::jsonb)
      from pos where con_producto
    ),
    'otros', (
      select coalesce(jsonb_agg(code order by code), '[]'::jsonb)
      from pos where not con_producto and not guarda
    ),
    'apartadas', (
      select coalesce(jsonb_agg(code order by code), '[]'::jsonb)
      from pos where not con_producto and guarda and apartada
    ),
    'no_alimento', (
      select coalesce(jsonb_agg(distinct cuadro), '[]'::jsonb)
      from pos where grupo = 'NO_ALIMENTO'
    ),
    -- ALMACEN no va: es el área de casi todo y mandarla sería mandar la bodega dos veces.
    'areas', (
      select coalesce(jsonb_object_agg(area, codigos), '{}'::jsonb)
      from (
        select area, jsonb_agg(code order by code) as codigos
        from pos where area is not null and area <> 'ALMACEN'
        group by area
      ) t
    ),
    'pilas', (
      select coalesce(
        jsonb_object_agg(code, jsonb_build_object('hay', hay, 'caben', greatest(caben, hay))),
        '{}'::jsonb
      )
      from pila
    )
  );
$f$;

comment on function planta() is
  'Todo lo que el mapa del tablero necesita, en una sola fila: qué posiciones tienen producto, '
  'cuáles están apartadas, cuáles son de otro uso, qué cuadros son de no alimento, qué '
  'posiciones tiene cada área que no sea el almacén y cuántos pallets hay apilados en cada '
  'posición de piso. Va en una función y no en una vista porque PostgREST corta las vistas en '
  'max_rows (1,000) y la bodega tiene 5,581 posiciones.';

grant execute on function planta() to authenticated;

drop function if exists que_hay_en(text);
create function que_hay_en(p_cuadro text)
returns table (
  location_code text,
  level smallint,
  area text,
  grupo text,
  dist_despacho_m numeric,
  usage_name text,
  guarda boolean,
  apartada boolean,
  caben integer,
  sku text,
  nombre text,
  lpn_code text,
  lot text,
  expiry_date date,
  qty_base numeric,
  cajas numeric,
  qty_allocated numeric
)
language sql
stable
security definer
set search_path = public as $f$
  select
    l.code, l.level, a.code, l.grupo, l.dist_despacho_m, u.name,
    coalesce(u.holds_product, true),
    l.reserved_by_task_id is not null,
    case
      when l.kind <> 'floor_stack' then 1
      else least(
        coalesce((
          select case when pc.allows_stacking then coalesce(pc.max_stack, 1) else 1 end
          from pallet_config pc
          where pc.product_id = s.product_id and pc.is_default
        ), 1),
        coalesce(l.max_pallets_stacked, 10)
      )
    end::integer,
    p.sku, p.name, lp.code, s.lot, s.expiry_date, s.qty_base,
    -- En cajas, que es como se cuenta en el andén. La unidad base no le dice nada a nadie.
    round(s.qty_base / nullif(pl.qty_base_units, 0), 2),
    s.qty_allocated
  from location l
  join location_usage u on u.code = l.usage_code
  left join location_area lar on lar.location_id = l.id and lar.valid_to is null
  left join area a on a.id = lar.area_id
  left join stock s on s.location_id = l.id and s.qty_base > 0
  left join product p on p.id = s.product_id
  left join lpn lp on lp.id = s.lpn_id
  left join packaging_level pl on pl.product_id = s.product_id and pl.code = 'CASE'
  where l.retired_at is null
    and regexp_replace(l.code, '-N\d+-', '-') = upper(trim(coalesce(p_cuadro, '')))
  order by l.level nulls first, l.code, p.sku;
$f$;

comment on function que_hay_en(text) is
  'Lo que hay bajo un cuadro del mapa, vacío incluido, y por qué está así: si guarda producto, '
  'si está apartada por una tarea y cuántos pallets le caben encima. En piso es una posición; '
  'en rack, la pila de niveles de esa bahía, que desde arriba se ven como un solo cuadro.';

grant execute on function que_hay_en(text) to authenticated;
