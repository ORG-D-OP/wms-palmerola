-- La cara de picking del rack es el frente
--
-- Con la 0093 se pudo medir una cosa que antes no se veía: en el rack de picking había **90
-- bahías con dos productos distintos**, el fondo con otra cosa que el frente. En doble
-- profundidad eso no se puede surtir: al fondo no se llega sin bajar el pallet del frente.
--
-- El área de picking del rack era el nivel 1 entero, los dos fondos: 608 posiciones. No son
-- 608 caras, son **304 caras y sus 304 reservas**. Así lo dice también la planimetría del
-- 12/11 («Picking nivel 1 + reserva en rack»).
--
-- Dos cosas, entonces:
--
-- 1. El fondo del nivel 1 pasa a ALMACEN. No se pierde: la regla de exclusividad del carril
--    —que mira todo el stock, sea de picking o de almacén— sólo deja entrar ahí el producto y
--    el lote que tiene la cara delante. Es su reserva, y ahora el guardado la puede usar.
-- 2. `reasignar_area` deja de poder romperlo. Las áreas se redibujan cada semana y la pantalla
--    las elige por zona y nivel, que no distingue frente de fondo. Si al jefe le dan picking a
--    una bahía, la cara es el frente y el fondo es la reserva: eso no es una preferencia, es
--    cómo está hecho el rack.
--
-- Después de esto: 500 caras de picking (196 de piso y 304 de rack) para 377 productos, y 304
-- posiciones de reserva más en almacén.

-- `reasignar_area` sólo mete en PICKING lo que de verdad puede ser una cara. El fondo de una
-- bahía de rack va a ALMACEN, que es lo que es: la reserva de la cara que tiene delante.
create or replace function reasignar_area(p_location_ids uuid[], p_area_code text)
returns integer language plpgsql security definer set search_path = public as $f$
declare
  v_area area;
  v_almacen area;
  v_caras uuid[];
  v_fondos uuid[];
  v_n integer;
begin
  if not has_role('supervisor', 'admin') then
    raise exception 'Solo el jefe de bodega cambia las áreas';
  end if;

  select * into v_area from area where code = p_area_code and is_active;
  if not found then
    raise exception 'El área % no existe', p_area_code;
  end if;

  v_caras := p_location_ids;
  v_fondos := '{}';

  if p_area_code = 'PICKING' then
    select coalesce(array_agg(l.id) filter (where not es_fondo), '{}'),
           coalesce(array_agg(l.id) filter (where es_fondo), '{}')
      into v_caras, v_fondos
    from (
      select l.id,
             l.kind in ('rack_single', 'rack_double_deep') and coalesce(l.depth_index, 1) > 1
               as es_fondo
      from location l
      where l.id = any(p_location_ids)
    ) l;

    if array_length(v_fondos, 1) > 0 then
      select * into v_almacen from area where code = 'ALMACEN' and is_active;
      if not found then
        raise exception 'No hay área de almacén activa donde dejar el fondo de las bahías';
      end if;
    end if;
  end if;

  update location_area set valid_to = clock_timestamp()
  where location_id = any(v_caras) and valid_to is null and area_id <> v_area.id;

  insert into location_area (location_id, area_id, valid_from)
  select l.id, v_area.id, clock_timestamp()
  from location l
  where l.id = any(v_caras)
    and not exists (
      select 1 from location_area x where x.location_id = l.id and x.valid_to is null
    );

  get diagnostics v_n = row_count;

  if array_length(v_fondos, 1) > 0 then
    update location_area set valid_to = clock_timestamp()
    where location_id = any(v_fondos) and valid_to is null and area_id <> v_almacen.id;

    insert into location_area (location_id, area_id, valid_from)
    select l.id, v_almacen.id, clock_timestamp()
    from location l
    where l.id = any(v_fondos)
      and not exists (
        select 1 from location_area x where x.location_id = l.id and x.valid_to is null
      );
  end if;

  return v_n;
end;
$f$;

comment on function reasignar_area(uuid[], text) is
  'Mueve posiciones de área. Al dar PICKING a una bahía de rack sólo el frente queda de cara: '
  'el fondo va a ALMACEN, que es su reserva, porque al fondo no se llega sin bajar el frente.';

-- Y el arreglo de lo que ya está: los 304 fondos del nivel 1 que hoy son cara de picking.
with fondos as (
  select l.id
  from location l
  join location_area lar on lar.location_id = l.id and lar.valid_to is null
  join area a on a.id = lar.area_id
  where a.code = 'PICKING'
    and l.kind in ('rack_single', 'rack_double_deep')
    and coalesce(l.depth_index, 1) > 1
),
cerrados as (
  update location_area set valid_to = clock_timestamp()
  where location_id in (select id from fondos) and valid_to is null
  returning location_id
)
insert into location_area (location_id, area_id, valid_from)
select c.location_id, a.id, clock_timestamp()
from cerrados c
cross join area a
where a.code = 'ALMACEN' and a.is_active;
