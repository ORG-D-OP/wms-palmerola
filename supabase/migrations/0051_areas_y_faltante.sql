/**
 * Del área almacén salen pallets completos, y nada más.
 *
 * La segunda pasada de `release_order` buscaba existencia en cualquier área no virtual y sólo
 * *prefería* picking, así que cuando picking no alcanzaba abría un pallet del almacén para
 * completar la línea. Eso rompe la regla de la bodega —del almacén sale pallet entero, del
 * área de picking salen cajas y unidades— y además deja medio pallet huérfano en una posición
 * pensada para pallets enteros, que es donde empiezan los descuadres.
 *
 * Ahora la segunda pasada mira únicamente el área de picking. Lo que no esté ahí, falta, y
 * faltar es precisamente la señal de que hace falta reabastecer picking: no es un error del
 * despacho, es trabajo para el supervisor.
 *
 * Lo que no cambia aquí: que el camión se abra aunque falte producto. Eso ya era así desde la
 * hoja de chequeo; lo que faltaba era la lista de abajo para poder verlo de un lado.
 */
create or replace function release_order(p_order_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_order sales_order;
  v_line order_line;
  v_destino uuid;
  v_falta numeric;
  v_toma numeric;
  v_task uuid;
  v_tareas integer := 0;
  s record;
begin
  if not has_role('auxiliar', 'chequeador', 'montacargista', 'supervisor', 'admin') then
    raise exception 'No tienes permiso para abrir un despacho';
  end if;

  select * into v_order from sales_order where id = p_order_id for update;
  if not found then
    raise exception 'El pedido no existe';
  end if;
  if v_order.status <> 'DRAFT' then
    raise exception 'El pedido ya está %', v_order.status;
  end if;
  if v_order.dock_door_id is null then
    raise exception 'El pedido necesita un andén de carga';
  end if;

  select l.id into v_destino
  from location l
  join dock_door d on d.id = v_order.dock_door_id
  where l.code = 'STG-' || d.code;

  for v_line in select * from order_line where order_id = p_order_id order by line_no loop
    v_falta := v_line.qty_base - coalesce(
      (select sum(c.qty_base) from order_crossdock c where c.order_line_id = v_line.id), 0);

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
    -- igual y la pantalla lo pinta.
  end loop;

  update sales_order set status = 'RELEASED', released_at = now() where id = p_order_id;
  return v_tareas;
end;
$$;

grant execute on function release_order to authenticated;

/**
 * Lo que falta en toda la bodega para los camiones que ya se abrieron.
 *
 * Es la lista de la que va a salir el reabastecimiento de picking: cada línea que no se pudo
 * apartar completa es producto que hay en el almacén pero no donde se saca. Va como función y
 * no como vista porque el reabastecimiento la va a querer por producto, no por camión.
 *
 * La aritmética es la misma que `falta_para_despacho` (0036) y aun así no se reusa, porque esa
 * cuenta también los camiones en `DRAFT`: un camión que todavía no se abre no tiene nada
 * apartado, así que contaría entero como faltante e inflaría esta lista con producto que sí
 * hay. Para el crossdock ese es el comportamiento correcto —la pregunta es si viene un camión
 * que necesite esto—; para reabastecer, no.
 */
create or replace function faltante_de_despachos()
returns table (
  product_id uuid,
  sku text,
  nombre text,
  falta numeric,
  camiones bigint
)
language sql stable security definer set search_path = public as $$
  select p.id, p.sku, p.name,
         sum(l.qty_base - coalesce(ap.apartado, 0) - coalesce(cd.cross, 0)) as falta,
         count(distinct l.order_id) as camiones
  from order_line l
  join sales_order o on o.id = l.order_id
  join product p on p.id = l.product_id
  left join lateral (
    select sum(a.qty_base) as apartado from allocation a where a.order_line_id = l.id
  ) ap on true
  left join lateral (
    select sum(c.qty_base) as cross from order_crossdock c where c.order_line_id = l.id
  ) cd on true
  where o.status in ('RELEASED', 'PICKING')
    and l.qty_base - coalesce(ap.apartado, 0) - coalesce(cd.cross, 0) > 0
  group by p.id, p.sku, p.name
  order by falta desc;
$$;

grant execute on function faltante_de_despachos to authenticated;
