/**
 * El aviso de reabastecimiento.
 *
 * Lanzar el reabastecimiento sigue siendo del supervisor —no hay olas, porque no se sabe de
 * antemano qué pedidos van a caer mañana—, pero el sistema sí puede avisarle antes de que una
 * posición de picking se quede sin nada: cuando le queda **menos de la mitad** de lo que cabe
 * en ella.
 *
 * El porcentaje es un dato, no un número escondido en el código: vive en el área, así que el
 * jefe lo sube o lo baja según cómo le esté yendo a la bodega, y si algún día hay más de un
 * área de picking cada una lleva el suyo.
 *
 * Lo que cabe en una posición de picking es **un pallet** del producto que está ahí, que es
 * con lo que se rellena: `cases_per_pallet` por las unidades de la caja. Y lo que se mira es
 * lo **disponible**, no el saldo: lo ya apartado para un camión no sirve para el siguiente.
 */
alter table area add column if not exists replenish_pct smallint not null default 50;

alter table area drop constraint if exists area_replenish_pct_ck;
alter table area add constraint area_replenish_pct_ck check (replenish_pct between 1 and 100);

comment on column area.replenish_pct is
  'Por debajo de este porcentaje de lo que cabe, la posición de picking sale en el aviso.';

create or replace view picking_bajo as
with slot as (
  select
    l.code as posicion,
    l.pick_sequence,
    a.replenish_pct,
    s.product_id,
    s.lot,
    s.expiry_date,
    s.qty_base - s.qty_allocated as disponible
  from stock s
  join location l on l.id = s.location_id
  join location_area la on la.location_id = l.id and la.valid_to is null
  join area a on a.id = la.area_id and a.type_code = 'PICKING' and a.is_active
  where l.retired_at is null and s.qty_base > 0
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
  t.lot,
  t.expiry_date,
  t.disponible,
  t.tope,
  t.por_caja,
  t.replenish_pct,
  floor(t.disponible / t.tope * 100)::int as pct,
  o.posicion as sacar_de,
  o.lot as lote_origen,
  o.expiry_date as vence_origen,
  o.disponible as hay_en_origen
from con_tope t
left join lateral (
  -- De dónde sacarlo: el pallet del mismo producto que primero vence, como manda FEFO.
  select l2.code as posicion, s2.lot, s2.expiry_date, s2.qty_base - s2.qty_allocated as disponible
  from stock s2
  join location l2 on l2.id = s2.location_id
  join location_area la2 on la2.location_id = l2.id and la2.valid_to is null
  join area a2 on a2.id = la2.area_id and a2.type_code = 'ALMACEN' and a2.is_active
  where s2.product_id = t.product_id
    and s2.qty_base - s2.qty_allocated > 0
    and l2.retired_at is null
  order by s2.expiry_date nulls last, l2.code
  limit 1
) o on true
where t.tope > 0
  and t.disponible < t.tope * t.replenish_pct / 100.0
order by floor(t.disponible / t.tope * 100), t.pick_sequence nulls last, t.posicion;

grant select on picking_bajo to authenticated;

/** El jefe sube o baja el listón según cómo le esté yendo. */
create or replace function ajustar_aviso_reabastecimiento(p_area_code text, p_pct smallint)
returns area
language plpgsql security definer set search_path = public as $$
declare
  v_area area;
begin
  if not has_role('supervisor', 'admin') then
    raise exception 'Sólo el jefe de bodega cambia el aviso de reabastecimiento';
  end if;
  if p_pct is null or p_pct < 1 or p_pct > 100 then
    raise exception 'El aviso tiene que estar entre 1 y 100 por ciento';
  end if;

  update area set replenish_pct = p_pct
  where code = p_area_code and is_active
  returning * into v_area;

  if not found then
    raise exception 'No existe el área %', p_area_code;
  end if;

  return v_area;
end;
$$;

grant execute on function ajustar_aviso_reabastecimiento to authenticated;
