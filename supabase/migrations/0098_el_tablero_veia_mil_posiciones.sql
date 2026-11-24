-- El tablero veía mil posiciones de 5,581
--
-- Con la bodega al 81% el plano del tablero se veía casi vacío. No era el dibujo: la API pide
-- `posicion_estado` con `limit 6000` y PostgREST corta en **1,000 filas**, que es el `max_rows`
-- del proyecto. Llegaban mil posiciones de las 4,526 que no están libres, así que el mapa
-- pintaba una de cada cuatro y el resto salía en blanco. Nadie lo notó mientras la bodega
-- estaba casi vacía, porque mil filas alcanzaban.
--
-- Subir `max_rows` arreglaría el síntoma y abriría la puerta a que cualquier consulta se traiga
-- la bodega entera sin querer. La respuesta es una función: una sola fila, un solo JSON, y
-- PostgREST no tiene nada que cortar.
--
-- De paso resuelve lo otro que el tablero no podía mostrar. El mapa sabía si una posición está
-- ocupada, pero no **de quién es**: qué zona admite alimento y cuál no, dónde están las caras
-- de picking, dónde la calidad. Eso es la segmentación de la planimetría, se redibuja cada
-- semana y hasta ahora sólo se veía leyendo códigos en la pantalla de áreas.

create or replace function planta()
returns jsonb
language sql
stable
security invoker
set search_path = public as $f$
  with pos as (
    select
      l.code,
      -- El cuadro de la planta: en rack los niveles son un solo cuadro vistos desde arriba.
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
      select coalesce(jsonb_object_agg(area, cuadros), '{}'::jsonb)
      from (
        select area, jsonb_agg(distinct cuadro) as cuadros
        from pos where area is not null and area <> 'ALMACEN'
        group by area
      ) t
    )
  );
$f$;

comment on function planta() is
  'Todo lo que el mapa del tablero necesita, en una sola fila: qué posiciones tienen producto, '
  'cuáles están apartadas, cuáles son de otro uso, qué cuadros son de no alimento y qué cuadros '
  'tiene cada área que no sea el almacén. Va en una función y no en una vista porque PostgREST '
  'corta las vistas en max_rows (1,000) y la bodega tiene 5,581 posiciones.';

grant execute on function planta() to authenticated;

-- Y lo que hay debajo de un cuadro, para cuando alguien lo toca en el mapa. Devuelve también
-- las posiciones vacías: saber que un hueco está libre es la mitad de la pregunta.
drop function if exists que_hay_en(text);
create function que_hay_en(p_cuadro text)
returns table (
  location_code text,
  level smallint,
  area text,
  grupo text,
  dist_despacho_m numeric,
  usage_name text,
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
  'Lo que hay bajo un cuadro del mapa, vacío incluido. En piso es una posición; en rack, la '
  'pila de niveles de esa bahía, que desde arriba se ven como un solo cuadro.';

grant execute on function que_hay_en(text) to authenticated;
