-- La cara de picking del carril de piso es la boca
--
-- La 0095 arreglo esto en el rack: la cara es el frente y el fondo es su reserva, porque al
-- fondo no se llega sin bajar el frente. En el piso quedo el mismo fallo, y mas grande.
--
-- El picking de piso eran **las dos columnas de los extremos de cada zona**: 196 posiciones en
-- 14 carriles enteros. Pero un carril de piso no es una fila de posiciones sueltas: es un
-- fondo de verdad, de 11 a 19 pallets de profundidad, que se carga y se surte por la boca. De
-- esas 196 caras, **182 estaban metidas dentro del carril**, y las 196 tenian saldo de **196
-- productos distintos**: en F5-001 habia diecinueve productos, uno detras de otro, y para
-- llegar al del fondo habia que bajar los dieciocho de adelante. Los 14 carriles de picking
-- eran los unicos 14 carriles de la bodega con mas de un producto.
--
-- La planimetria del 12/11/2026 lo dice en una linea, y su maestro no marca ni una sola
-- posicion de piso como picking:
--
--     if (pos.tipo === "piso") return esFrenteCarril ? "picking" : "reserva";
--     return (pos.nivel === 1 && pos.prof === "F") ? "picking" : "reserva";
--
-- Comprobado contra sus tres escenarios: de las 143 caras de piso que reparte, **las 143 caen
-- en la boca del carril**, ninguna en el fondo. Y la boca es siempre el extremo que da al
-- pasillo del sur, el de despacho, que es la posicion de menor dist_despacho_m del carril.
--
-- Asi que son **200 caras de piso**, una por carril, y el resto del carril es la reserva de
-- esa misma cara: la regla de exclusividad ya lo garantiza, porque mira todo el saldo del
-- carril, sea de picking o de almacen. Es el «pallet completo + picking frontal» de la
-- planimetria, y sale gratis.
--
-- Despues de esto: 504 caras —200 de piso y 304 de rack— y 2,565 posiciones de almacen en
-- piso, cuatro menos que antes. Lo que cambia no es el numero sino quien tiene respaldo: antes
-- 186 carriles de almacen sueltos y 14 de picking; ahora 200 carriles que son cara y respaldo
-- del mismo producto.

-- `reasignar_area` deja de poder romperlo, igual que con el fondo del rack. El jefe redibuja
-- las areas por zona y nivel, y ni la zona ni el nivel distinguen la boca del fondo: si pide
-- picking para un carril de piso, la cara es la boca y lo de atras es su reserva.
create or replace function reasignar_area(p_location_ids uuid[], p_area_code text)
returns integer language plpgsql security definer set search_path = public as $f$
declare
  v_area area;
  v_almacen area;
  v_caras uuid[];
  v_reservas uuid[];
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
  v_reservas := '{}';

  if p_area_code = 'PICKING' then
    select coalesce(array_agg(l.id) filter (where l.cara), '{}'),
           coalesce(array_agg(l.id) filter (where not l.cara), '{}')
      into v_caras, v_reservas
    from (
      select
        l.id,
        case
          when l.kind in ('rack_single', 'rack_double_deep')
            then coalesce(l.depth_index, 1) = 1
          when z.kind = 'floor'
            then l.dist_despacho_m is null
              or l.dist_despacho_m = (
                select min(o.dist_despacho_m)
                from location o
                where o.carril = l.carril and o.retired_at is null
              )
          else true
        end as cara
      from location l
      join lane la on la.id = l.lane_id
      join zone z on z.id = la.zone_id
      where l.id = any(p_location_ids)
    ) l;

    if array_length(v_reservas, 1) > 0 then
      select * into v_almacen from area where code = 'ALMACEN' and is_active;
      if not found then
        raise exception 'No hay área de almacén activa donde dejar la reserva del carril';
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

  if array_length(v_reservas, 1) > 0 then
    update location_area set valid_to = clock_timestamp()
    where location_id = any(v_reservas) and valid_to is null and area_id <> v_almacen.id;

    insert into location_area (location_id, area_id, valid_from)
    select l.id, v_almacen.id, clock_timestamp()
    from location l
    where l.id = any(v_reservas)
      and not exists (
        select 1 from location_area x where x.location_id = l.id and x.valid_to is null
      );
  end if;

  return v_n;
end;
$f$;

comment on function reasignar_area(uuid[], text) is
  'Mueve posiciones de área. Al dar PICKING sólo queda de cara lo que de verdad se puede '
  'surtir: el frente de la bahía en rack y la boca del carril en piso. Lo de atrás va a '
  'ALMACEN, que es su reserva.';

-- Y el arreglo de lo que ya esta declarado. No declara picking donde no lo habia: en una base
-- recien creada el picking sigue naciendo vacio, porque cual posicion puede ser cara lo dice
-- el plano, pero cual se surte a mano lo dice el jefe.
do $$
declare
  v_almacen uuid;
  v_picking uuid;
begin
  select id into v_picking from area where code = 'PICKING' and is_active;
  select id into v_almacen from area where code = 'ALMACEN' and is_active;
  if v_picking is null or v_almacen is null then
    return;
  end if;

  if not exists (
    select 1
    from location l
    join lane la on la.id = l.lane_id
    join zone z on z.id = la.zone_id
    join location_area lar on lar.location_id = l.id and lar.valid_to is null
    where z.kind = 'floor' and lar.area_id = v_picking
  ) then
    return;
  end if;

  create temporary table piso_cara on commit drop as
  select
    l.id,
    l.dist_despacho_m = min(l.dist_despacho_m) over (partition by l.carril) as es_boca
  from location l
  join lane la on la.id = l.lane_id
  join zone z on z.id = la.zone_id
  where z.kind = 'floor' and l.retired_at is null and l.dist_despacho_m is not null;

  update location_area lar set valid_to = clock_timestamp()
  from piso_cara c
  where c.id = lar.location_id
    and lar.valid_to is null
    and lar.area_id <> case when c.es_boca then v_picking else v_almacen end;

  insert into location_area (location_id, area_id, valid_from)
  select c.id, case when c.es_boca then v_picking else v_almacen end, clock_timestamp()
  from piso_cara c
  where not exists (
    select 1 from location_area x where x.location_id = c.id and x.valid_to is null
  );
end $$;

-- El reabastecimiento sabe de donde sacarlo: con la cara en la boca, la reserva de un carril
-- de piso esta justo detras, y ese viaje es el mas corto que hay. FEFO sigue mandando —dia
-- exacto, sin tolerancia—; el carril propio y la distancia solo desempatan.
create or replace view picking_bajo as
with slot as (
  select
    l.code as posicion,
    min(l.pick_sequence) as pick_sequence,
    min(l.carril) as carril,
    min(a.replenish_pct) as replenish_pct,
    s.product_id,
    greatest(
      sum(
        case
          when vence_demasiado_pronto(s.expiry_date) then 0
          else s.qty_base - s.qty_allocated
        end
      ),
      0
    ) as disponible
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
  o.expiry_date as vence_origen,
  ocupa.producto as ocupada_por
from con_tope t
left join lateral (
  select l2.code as posicion, s2.expiry_date
  from stock s2
  join location l2 on l2.id = s2.location_id
  join location_area la2 on la2.location_id = l2.id and la2.valid_to is null
  join area a2 on a2.id = la2.area_id and a2.type_code = 'ALMACEN' and a2.is_active
  where s2.product_id = t.product_id
    and s2.qty_base - s2.qty_allocated > 0
    and l2.retired_at is null
    and not vence_demasiado_pronto(s2.expiry_date)
  order by
    s2.expiry_date nulls last,
    (l2.carril = t.carril) desc,
    l2.dist_despacho_m nulls last,
    l2.code
  limit 1
) o on true
left join lateral (
  select p3.name as producto
  from stock s3
  join location l3 on l3.id = s3.location_id
  join product p3 on p3.id = s3.product_id
  where l3.code = t.posicion
    and s3.product_id <> t.product_id
    and s3.qty_base > 0
  order by s3.qty_base desc, p3.name
  limit 1
) ocupa on true
where t.tope > 0
  and t.disponible < t.tope * t.replenish_pct / 100.0
order by floor(t.disponible / t.tope * 100), t.pick_sequence nulls last, t.posicion;

grant select on picking_bajo to authenticated;
