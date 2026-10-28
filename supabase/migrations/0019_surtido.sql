create type order_status as enum (
  'DRAFT', 'RELEASED', 'PICKING', 'PICKED', 'SHIPPED', 'CANCELLED'
);

-- Una posición de salida por cada andén de carga, donde se consolida lo surtido.
insert into lane (zone_id, code, depth)
select z.id, 'STG-' || d.code, 1
from dock_door d
join zone z on z.code = 'PREP-S' and z.site_id = d.site_id
where d.direction = 'outbound';

insert into location (lane_id, code, barcode, kind)
select l.id, l.code, l.code, 'staging'
from lane l join zone z on z.id = l.zone_id
where z.code = 'PREP-S' and l.code like 'STG-AND-S-%';

create table sales_order (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (length(trim(code)) between 1 and 40),
  customer text,
  dock_door_id uuid references dock_door on delete restrict,
  wave_id uuid references wave on delete set null,
  status order_status not null default 'DRAFT',
  created_at timestamptz not null default now(),
  released_at timestamptz,
  shipped_at timestamptz,
  created_by uuid references auth.users on delete set null
);

create table order_line (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references sales_order on delete cascade,
  line_no smallint not null check (line_no > 0),
  product_id uuid not null references product on delete restrict,
  packaging_level_id uuid references packaging_level on delete restrict,
  qty_base numeric(14, 3) not null check (qty_base > 0),
  unique (order_id, line_no)
);

/**
 * Lo que una línea tiene apartado en una existencia concreta. Mientras viva, esa
 * cantidad no la puede tomar otra ola: es lo que impide que dos pedidos cuenten con
 * el mismo pallet.
 */
create table allocation (
  id uuid primary key default gen_random_uuid(),
  order_line_id uuid not null references order_line on delete cascade,
  stock_id uuid not null references stock on delete restrict,
  qty_base numeric(14, 3) not null check (qty_base > 0),
  task_id uuid references task on delete set null,
  created_at timestamptz not null default now()
);

create index allocation_por_tarea on allocation (task_id);

create trigger sales_order_audit after insert or update or delete on sales_order
for each row execute function audit_changes();

/**
 * Aparta existencia para el pedido y deja una tarea de surtido por cada apartado.
 *
 * Elige por FEFO, pero entre dos lotes igual de buenos prefiere el que está al frente
 * del carril: sacar el de atrás cuesta tres maniobras en vez de una.
 * Si una línea no se puede cubrir entera, no aparta nada y dice cuánto falta.
 */
create function release_order(p_order_id uuid) returns integer
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
  if not has_role('supervisor', 'admin') then
    raise exception 'No tienes permiso para liberar pedidos';
  end if;

  select * into v_order from sales_order where id = p_order_id for update;
  if not found then
    raise exception 'El pedido no existe';
  end if;
  if v_order.status <> 'DRAFT' then
    raise exception 'El pedido ya esta %', v_order.status;
  end if;
  if v_order.dock_door_id is null then
    raise exception 'El pedido necesita un anden de carga';
  end if;

  select l.id into v_destino
  from location l
  join dock_door d on d.id = v_order.dock_door_id
  where l.code = 'STG-' || d.code;

  for v_line in select * from order_line where order_id = p_order_id order by line_no loop
    v_falta := v_line.qty_base;

    for s in
      select st.id, st.location_id, st.lot, st.expiry_date, st.lpn_id,
             st.qty_base - st.qty_allocated as libre
      from stock st
      join location lo on lo.id = st.location_id
      join lane la on la.id = lo.lane_id
      join zone z on z.id = la.zone_id
      where st.product_id = v_line.product_id
        and st.qty_base > st.qty_allocated
        and z.kind in ('floor', 'rack')
      order by st.expiry_date nulls last, lo.depth_index, lo.pick_sequence nulls last, lo.code
    loop
      exit when v_falta <= 0;

      v_toma := least(v_falta, s.libre);
      update stock set qty_allocated = qty_allocated + v_toma where id = s.id;

      insert into task (
        type, product_id, qty_base, packaging_level_id, lpn_id, lot, expiry_date,
        from_location_id, to_location_id, priority
      )
      values (
        'PICK', v_line.product_id, v_toma, v_line.packaging_level_id, s.lpn_id, s.lot,
        s.expiry_date, s.location_id, v_destino, 200
      )
      returning id into v_task;

      insert into allocation (order_line_id, stock_id, qty_base, task_id)
      values (v_line.id, s.id, v_toma, v_task);

      v_falta := v_falta - v_toma;
      v_tareas := v_tareas + 1;
    end loop;

    if v_falta > 0 then
      raise exception 'Falta existencia de la linea %: hacen falta % mas', v_line.line_no, v_falta
        using errcode = 'check_violation';
    end if;
  end loop;

  update sales_order set status = 'RELEASED', released_at = now() where id = p_order_id;
  return v_tareas;
end;
$$;

/** El operario llega y escanea la posición: si no es la de la tarea, se detiene. */
create function start_pick(p_task_id uuid, p_location_code text) returns task
language plpgsql security definer set search_path = public as $$
declare
  v_task task;
  v_esperada text;
begin
  select * into v_task from task where id = p_task_id;
  if not found then
    raise exception 'La tarea no existe';
  end if;
  if v_task.assigned_to is distinct from auth.uid() then
    raise exception 'Esa tarea no es tuya';
  end if;
  if v_task.status <> 'ASSIGNED' then
    raise exception 'La tarea ya empezó o está cerrada';
  end if;

  select code into v_esperada from location where id = v_task.from_location_id;
  if v_esperada is distinct from trim(p_location_code) then
    raise exception 'Esa no es la posición de esta tarea. La correcta es la %', v_esperada;
  end if;

  update task set status = 'IN_PROGRESS', started_at = now()
  where id = p_task_id
  returning * into v_task;

  return v_task;
end;
$$;

/**
 * Cierra el surtido contra el producto escaneado. Acepta una cantidad menor a la
 * pedida —en bodega pasa que no estaba todo— y entonces libera lo apartado de más
 * para que otra ola pueda tomarlo.
 */
create function complete_pick(p_task_id uuid, p_barcode text, p_qty numeric)
returns table (surtido numeric, pedido numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_task task;
  v_alloc allocation;
  v_producto uuid;
begin
  select * into v_task from task where id = p_task_id;
  if not found then
    raise exception 'La tarea no existe';
  end if;
  if v_task.assigned_to is distinct from auth.uid() then
    raise exception 'Esa tarea no es tuya';
  end if;
  if v_task.status <> 'IN_PROGRESS' then
    raise exception 'Primero escanea la posición';
  end if;
  if p_qty <= 0 or p_qty > v_task.qty_base then
    raise exception 'La cantidad tiene que estar entre 1 y %', v_task.qty_base;
  end if;

  select pl.product_id into v_producto
  from barcode b join packaging_level pl on pl.id = b.packaging_level_id
  where b.code = trim(p_barcode)
  limit 1;

  if v_producto is distinct from v_task.product_id then
    raise exception 'Ese no es el producto de esta tarea';
  end if;

  -- Se libera lo apartado ANTES de mover: si no, por un instante quedaria reservado
  -- mas de lo que hay en la posicion y salta la restriccion.
  select * into v_alloc from allocation where task_id = p_task_id;
  if v_alloc.id is not null then
    update stock set qty_allocated = greatest(0, qty_allocated - v_alloc.qty_base)
    where id = v_alloc.stock_id;
    update allocation set qty_base = p_qty where id = v_alloc.id;
  end if;

  perform post_movement(
    'PICK', v_task.product_id, p_qty, v_task.from_location_id, v_task.to_location_id,
    v_task.lpn_id, v_task.lot, v_task.expiry_date, 'VENTA', null, v_task.packaging_level_id,
    p_task_id, null, 'pick-' || p_task_id::text
  );

  update task set status = 'DONE', completed_at = now(), qty_base = p_qty
  where id = p_task_id;

  update sales_order o set status = 'PICKING'
  where o.status = 'RELEASED'
    and exists (
      select 1 from order_line ol join allocation a on a.order_line_id = ol.id
      where ol.order_id = o.id and a.task_id = p_task_id
    );

  return query select p_qty, v_task.qty_base;
end;
$$;

alter table sales_order enable row level security;
alter table order_line enable row level security;
alter table allocation enable row level security;

create policy sales_order_read on sales_order for select to authenticated using (true);
create policy order_line_read on order_line for select to authenticated using (true);
create policy allocation_read on allocation for select to authenticated using (true);

create policy sales_order_write on sales_order for all to authenticated
  using (has_role('supervisor', 'admin')) with check (has_role('supervisor', 'admin'));
create policy order_line_write on order_line for all to authenticated
  using (has_role('supervisor', 'admin')) with check (has_role('supervisor', 'admin'));

grant select on sales_order, order_line, allocation to authenticated;
grant insert, update, delete on sales_order, order_line to authenticated;
grant execute on function release_order, start_pick, complete_pick to authenticated;
