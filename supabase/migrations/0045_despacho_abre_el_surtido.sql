/**
 * El despacho lo abre quien escanea la hoja.
 *
 * Aquí no se hacen pedidos: lo que entra a la bodega es un ingreso y lo que sale es un
 * tabulado de despacho, los dos traídos de SAP. Por eso se fue la pantalla donde un
 * supervisor tecleaba pedidos y los liberaba a mano, y con ella el único lugar desde donde
 * se armaban las tareas de surtido. Ahora las arma el escaneo de la hoja, que es el momento
 * en que el camión existe para la bodega.
 *
 * Lo único que cambia de la función es quién la puede llamar: los mismos que reciben, que
 * son los que van a tener la hoja en la mano. Cerrar el camión sigue siendo del chequeador.
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

    -- Segunda pasada: lo que sobra ya no llena un pallet, y eso se saca de picking.
    for s in
      select st.id, st.location_id, st.lot, st.expiry_date, st.lpn_id,
             st.qty_base - st.qty_allocated as libre,
             coalesce(lo.level, 0) as nivel,
             case when a.code = 'PICKING' then 0 else 1 end as prioridad_area
      from stock st
      join location lo on lo.id = st.location_id
      join location_usage u on u.code = lo.usage_code
      join location_area lar on lar.location_id = lo.id and lar.valid_to is null
      join area a on a.id = lar.area_id
      join area_type tp on tp.code = a.type_code
      where st.product_id = v_line.product_id
        and st.qty_base > st.qty_allocated
        and u.holds_product
        and a.is_active
        and not tp.is_virtual
      order by
        prioridad_area,
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

    if v_falta > 0 then
      raise exception 'Falta existencia de la línea %: hacen falta % más',
        v_line.line_no, trim_scale(v_falta)
        using errcode = 'check_violation';
    end if;
  end loop;

  update sales_order set status = 'RELEASED', released_at = now() where id = p_order_id;
  return v_tareas;
end;
$$;

grant execute on function release_order to authenticated;
