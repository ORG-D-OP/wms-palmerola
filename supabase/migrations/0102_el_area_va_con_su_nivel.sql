-- El area va con su nivel
--
-- `planta()` mandaba las areas por cuadro, y un cuadro de rack son sus seis niveles vistos
-- desde arriba (migracion 0098). Para el mapa de dos dimensiones esta bien: ahi un cuadro es
-- un cuadrito y lleva un solo color. Para la vista isometrica no, porque ahi cada caja es una
-- posicion con su nivel, y la cara de picking de un rack es el nivel 1 del frente y nada mas
-- (migracion 0101). Con el area por cuadro, la columna entera salia pintada de picking.
--
-- Asi que las areas van por codigo de posicion, igual que `ocupadas`, `apartadas` y `otros`.
-- El cuadro lo saca el dibujo quitandole el nivel al codigo, que es la misma cuenta que hacia
-- esta funcion. `no_alimento` sigue por cuadro: el grupo es de la corrida entera, nunca de un
-- nivel suelto.
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
      select coalesce(jsonb_object_agg(area, codigos), '{}'::jsonb)
      from (
        select area, jsonb_agg(code order by code) as codigos
        from pos where area is not null and area <> 'ALMACEN'
        group by area
      ) t
    )
  );
$f$;

comment on function planta() is
  'Todo lo que el mapa del tablero necesita, en una sola fila: qué posiciones tienen producto, '
  'cuáles están apartadas, cuáles son de otro uso, qué cuadros son de no alimento y qué '
  'posiciones tiene cada área que no sea el almacén. Las áreas van por posición y no por '
  'cuadro porque la vista isométrica dibuja cada nivel aparte y la cara de picking de un rack '
  'es sólo el nivel 1 del frente. Va en una función y no en una vista porque PostgREST corta '
  'las vistas en max_rows (1,000) y la bodega tiene 5,581 posiciones.';

grant execute on function planta() to authenticated;
