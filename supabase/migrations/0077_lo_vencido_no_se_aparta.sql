/**
 * Lo vencido se surtía **de primero**, y nadie lo decía.
 *
 * Probado a clic el 13 de noviembre: al liberar un camión, el reparto apartó 3,480 unidades de
 * un producto que venció **el día anterior**. No por casualidad: el reparto es FEFO puro
 * —`order by expiry_date`— y la fecha más vieja de todas es la del vencido, así que es lo
 * primero que el sistema manda a cargar. En la base de verdad hay 20 renglones vencidos, 8
 * productos, 53,448 unidades, y todos estaban disponibles.
 *
 * Buscando `current_date` en las 76 migraciones sale **una sola vez**, y es para una fecha por
 * omisión. O sea que no era que faltara un aviso: el concepto «vencido» no existía. Y eso va
 * contra algo que ya estaba decidido —el vencido va a desguace— y contra la migración 0073,
 * que trajo `VENCIDO_BOD`, «Vencido en bodega», como motivo de merma de SAP. Estaba decidido a
 * dónde va, y el sistema mientras tanto lo mandaba a cargar en un camión.
 *
 * El día es el **de la bodega**, no el del servidor: `pg_cron` y Postgres corren en UTC, donde
 * «hoy» cambia a las seis de la tarde de Comayagua. Sale de `site.time_zone`, igual que la
 * medianoche de la 0072.
 *
 * Y cuántos días antes de la fecha deja de poder salir **es una decisión de la bodega**, no
 * una constante: no es lo mismo vencido que «le quedan tres días y el viaje es de dos». Queda
 * como parámetro del sitio, en cero, que es lo único que se puede afirmar sin preguntar: lo
 * que ya venció no sale. Subirlo a 3 ó 7 es un `update` de una fila, sin tocar código.
 */
alter table site add column if not exists expiry_block_days smallint not null default 0;

alter table site drop constraint if exists site_expiry_block_days_check;
alter table site add constraint site_expiry_block_days_check
  check (expiry_block_days between 0 and 90);

comment on column site.expiry_block_days is
  'Cuántos días antes de la fecha deja de poder salir el producto. Cero: sólo lo ya vencido.';

create or replace function dias_antes_de_vencer() returns smallint
language sql stable set search_path = public as $f$
  select coalesce(min(expiry_block_days), 0)::smallint from site;
$f$;

create or replace function hoy_de_bodega() returns date
language sql stable set search_path = public as $f$
  -- El día de la bodega. En UTC «hoy» cambia a media tarde de Comayagua, y esto se usa para
  -- decidir si un lote todavía puede salir.
  select (now() at time zone reloj_de_bodega())::date;
$f$;

/**
 * Sin fecha no se puede decir que esté vencido, así que pasa. Es lo mismo que hace el FEFO con
 * los `nulls last`: lo que no tiene fecha va al final, pero va.
 */
create or replace function vence_demasiado_pronto(p_expiry date) returns boolean
language sql stable set search_path = public as $f$
  select p_expiry is not null and p_expiry < hoy_de_bodega() + dias_antes_de_vencer();
$f$;

grant execute on function dias_antes_de_vencer to authenticated;
grant execute on function hoy_de_bodega to authenticated;
grant execute on function vence_demasiado_pronto to authenticated;

/**
 * Y lo que el error ya dejó apartado se suelta, que si no la regla sólo vale para los camiones
 * de mañana. En la base real es un camión con **3,480 unidades** que vencieron el 12 de
 * noviembre, apartadas en dos posiciones.
 *
 * Se suelta como lo suelta `despachar` cuando se cierra un camión corto: la existencia deja de
 * estar reservada, la tarea queda anulada y la línea vuelve a quedar con su faltante, que es
 * lo que `apartar_lo_que_falta` vuelve a intentar cuando haya producto bueno. Lo ya **surtido**
 * no se toca: eso ya bajó al andén y deshacerlo sería inventar un movimiento.
 */
do $vencido$
declare
  v record;
begin
  for v in
    select a.id, a.stock_id, a.qty_base, a.task_id
    from allocation a
    join stock st on st.id = a.stock_id
    join task t on t.id = a.task_id
    where vence_demasiado_pronto(st.expiry_date)
      and t.status in ('READY', 'ASSIGNED', 'BLOCKED')
  loop
    update stock set qty_allocated = greatest(qty_allocated - v.qty_base, 0)
    where id = v.stock_id;
    update task set status = 'CANCELLED' where id = v.task_id;
    delete from allocation where id = v.id;
  end loop;
end
$vencido$;

/** El reparto salta lo vencido, igual que salta lo que ya está apartado. */
create or replace function apartar_linea(p_order_line_id uuid) returns integer
language plpgsql security definer set search_path = public as $f$
declare
  v_line order_line;
  v_destino uuid;
  v_falta numeric;
  v_toma numeric;
  v_task uuid;
  v_tareas integer := 0;
  s record;
begin
  select * into v_line from order_line where id = p_order_line_id;
  if not found then
    raise exception 'Esa línea del pedido no existe';
  end if;

  select l.id into v_destino
  from sales_order o
  join dock_door d on d.id = o.dock_door_id
  join location l on l.code = 'STG-' || d.code
  where o.id = v_line.order_id;

  if v_destino is null then
    raise exception 'El pedido necesita un andén de carga';
  end if;

  v_falta := v_line.qty_base
    - coalesce((select sum(a.qty_base) from allocation a where a.order_line_id = v_line.id), 0)
    - coalesce((select sum(c.qty_base) from order_crossdock c where c.order_line_id = v_line.id), 0);

  if v_falta <= 0 then
    return 0;
  end if;

  -- Primera pasada: pallets enteros de almacén, sin partir ninguno.
  for s in
    select st.id, st.location_id, st.lot, st.expiry_date, st.lpn_id, st.qty_base as libre,
           coalesce(lo.level, 0) as nivel
    from stock st
    join location lo on lo.id = st.location_id
    join location_usage u on u.code = lo.usage_code
    join location_area lar on lar.location_id = lo.id and lar.valid_to is null
    join area a on a.id = lar.area_id
    where st.product_id = v_line.product_id
      and st.qty_allocated = 0
      and st.qty_base > 0
      and st.lpn_id is not null
      and a.code = 'ALMACEN'
      and u.holds_product
      and a.is_active
      and not vence_demasiado_pronto(st.expiry_date)
    order by st.expiry_date nulls last, lo.depth_index, coalesce(lo.level, 0), lo.code
  loop
    exit when v_falta <= 0;
    continue when s.libre > v_falta;

    update stock set qty_allocated = qty_base where id = s.id;

    insert into task (
      type, product_id, qty_base, packaging_level_id, lpn_id, lot, expiry_date,
      from_location_id, to_location_id, priority, min_level, flow
    )
    values (
      'PICK', v_line.product_id, s.libre, v_line.packaging_level_id, s.lpn_id, s.lot,
      s.expiry_date, s.location_id, v_destino, 200, s.nivel, 'OUTBOUND'
    )
    returning id into v_task;

    insert into allocation (order_line_id, stock_id, qty_base, task_id)
    values (v_line.id, s.id, s.libre, v_task);

    v_falta := v_falta - s.libre;
    v_tareas := v_tareas + 1;
  end loop;

  -- Segunda pasada: lo que ya no llena un pallet sale de picking, y sólo de picking.
  for s in
    select st.id, st.location_id, st.lot, st.expiry_date, st.lpn_id,
           st.qty_base - st.qty_allocated as libre,
           coalesce(lo.level, 0) as nivel
    from stock st
    join location lo on lo.id = st.location_id
    join location_usage u on u.code = lo.usage_code
    join location_area lar on lar.location_id = lo.id and lar.valid_to is null
    join area a on a.id = lar.area_id
    where st.product_id = v_line.product_id
      and st.qty_base > st.qty_allocated
      and u.holds_product
      and a.code = 'PICKING'
      and a.is_active
      and not vence_demasiado_pronto(st.expiry_date)
    order by
      st.expiry_date nulls last,
      lo.depth_index,
      lo.pick_sequence nulls last,
      lo.code
  loop
    exit when v_falta <= 0;

    v_toma := least(v_falta, s.libre);
    update stock set qty_allocated = qty_allocated + v_toma where id = s.id;

    insert into task (
      type, product_id, qty_base, packaging_level_id, lpn_id, lot, expiry_date,
      from_location_id, to_location_id, priority, min_level, flow
    )
    values (
      'PICK', v_line.product_id, v_toma, v_line.packaging_level_id, s.lpn_id, s.lot,
      s.expiry_date, s.location_id, v_destino, 200, s.nivel, 'OUTBOUND'
    )
    returning id into v_task;

    insert into allocation (order_line_id, stock_id, qty_base, task_id)
    values (v_line.id, s.id, v_toma, v_task);

    v_falta := v_falta - v_toma;
    v_tareas := v_tareas + 1;
  end loop;

  -- Lo que quede sin apartar es el faltante. No se levanta excepción: el camión se abre
  -- igual, la hoja lo pinta, y `apartar_lo_que_falta` lo vuelve a intentar cuando haya.
  return v_tareas;
end;
$f$;

/**
 * Y el aviso de reabastecimiento deja de mandar pallets vencidos a picking, que es donde se
 * surte. En la lista de hoy la primera posición decía «sácalo de F2-006-03 · vence
 * 2026-11-12».
 *
 * De paso, lo vencido que ya está **en** una posición de picking deja de contar como
 * disponible: si no, la posición parece llena de un producto que el reparto no puede tomar y
 * el aviso no salta nunca. Cuenta como cero, no desaparece: la posición tiene que seguir
 * saliendo en la lista, y primero.
 */
create or replace view picking_bajo as
with slot as (
  select
    l.code as posicion,
    min(l.pick_sequence) as pick_sequence,
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
  o.expiry_date as vence_origen
from con_tope t
left join lateral (
  -- De dónde sacarlo: el pallet del mismo producto que primero vence, como manda FEFO, de los
  -- que todavía pueden salir.
  select l2.code as posicion, s2.expiry_date
  from stock s2
  join location l2 on l2.id = s2.location_id
  join location_area la2 on la2.location_id = l2.id and la2.valid_to is null
  join area a2 on a2.id = la2.area_id and a2.type_code = 'ALMACEN' and a2.is_active
  where s2.product_id = t.product_id
    and s2.qty_base - s2.qty_allocated > 0
    and l2.retired_at is null
    and not vence_demasiado_pronto(s2.expiry_date)
  order by s2.expiry_date nulls last, l2.code
  limit 1
) o on true
where t.tope > 0
  and t.disponible < t.tope * t.replenish_pct / 100.0
order by floor(t.disponible / t.tope * 100), t.pick_sequence nulls last, t.posicion;

grant select on picking_bajo to authenticated;
