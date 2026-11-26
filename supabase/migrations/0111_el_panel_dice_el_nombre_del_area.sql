/**
 * El panel del mapa escribía el área en crudo.
 *
 * Al tocar un cuadro salía «ALMACEN», que es el código con el que la tabla se llama a sí
 * misma, cuando en el resto de la aplicación esa área se lee «Almacén de pallets completos».
 * El nombre bueno ya está en `area.name` desde la 0024; `que_hay_en` devolvía `a.code`
 * porque era lo primero que había a mano.
 *
 * Va en la función y no en la pantalla a propósito: una tabla de códigos a nombres escrita
 * en el front es una segunda lista que se desfasa el día que el jefe de bodega cree un área,
 * y las áreas las crea él.
 */

create or replace function que_hay_en(p_cuadro text)
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
    l.code, l.level, a.name, l.grupo, l.dist_despacho_m, u.name,
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
  'en rack, la pila de niveles de esa bahía, que desde arriba se ven como un solo cuadro. El '
  'área va con su nombre, no con su código.';

grant execute on function que_hay_en(text) to authenticated;
