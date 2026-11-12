-- ---------------------------------------------------------------------------------------
-- El recuento tambien cuenta las sueltas
-- ---------------------------------------------------------------------------------------
--
-- `recontar` recibia cajas y nada mas, y fijaba el saldo en «cajas por unidades por caja». En
-- un pallet entero eso da igual, pero en picking casi nunca hay un numero redondo: una
-- posicion con 5 cajas y 7 unidades sueltas, confirmada tal y como la pintaba la pantalla, se
-- quedaba en 5 cajas justas. El recuento se comia las 7 sueltas y ademas se las apuntaba de
-- descuadre a quien conto, que no habia hecho nada malo.
--
-- Ahora se cuentan las dos cosas, que es como se cuenta en la bodega: «cinco cajas y siete
-- sueltas». La respuesta las devuelve separadas para que la pantalla no tenga que dividir, y
-- «decia» pasa a ser cajas enteras mas su resto, en vez de un 5.29 que nadie sabe leer.

drop function if exists recontar(text, numeric, text, text, uuid);

create or replace function recontar(
  p_lugar text,
  p_cajas numeric,
  p_sueltas numeric default 0,
  p_pallet text default null,
  p_nota text default null,
  p_task_id uuid default null
) returns table (
  decia numeric,
  decia_sueltas numeric,
  habia numeric,
  habia_sueltas numeric,
  diferencia numeric,
  por_caja numeric,
  tareas integer,
  de_donde text,
  falta numeric
)
language plpgsql security definer set search_path = public as $$
declare
  v_lugar text := upper(trim(coalesce(p_lugar, '')));
  v_pallet text := nullif(upper(trim(coalesce(p_pallet, ''))), '');
  v_sueltas numeric := coalesce(p_sueltas, 0);
  v_cuantos integer;
  v_lista text;
  s record;
  v_case uuid;
  v_por_caja numeric;
  v_nuevo numeric;
  v_diff numeric;
  v_libera numeric;
  v_pendiente numeric;
  v_nota text;
  v_mov bigint;
  v_lineas uuid[] := '{}';
  v_antes uuid[] := '{}';
  v_tareas integer := 0;
  v_de_donde text;
  v_falta numeric := 0;
  a record;
  ol uuid;
begin
  if not has_role('auxiliar', 'chequeador', 'montacargista', 'supervisor', 'admin') then
    raise exception 'No tienes permiso para contar';
  end if;
  if v_lugar = '' then
    raise exception 'Escanea el lugar';
  end if;
  if p_cajas is null or p_cajas < 0 then
    raise exception 'Escribe cuántas cajas hay, aunque sean cero';
  end if;
  if v_sueltas < 0 then
    raise exception 'Las unidades sueltas no pueden ser menos que cero';
  end if;

  if p_task_id is not null then
    if not exists (
      select 1 from task t
      where t.id = p_task_id and t.assigned_to = auth.uid()
        and t.status in ('ASSIGNED', 'IN_PROGRESS')
    ) then
      raise exception 'Esa tarea de conteo no es tuya o ya está cerrada';
    end if;
  end if;

  select count(*), string_agg(coalesce(h.lpn_code, 'suelto') || ' (' || h.sku || ')', ', ')
    into v_cuantos, v_lista
  from hay_en(v_lugar) h
  where v_pallet is null or h.lpn_code = v_pallet;

  if v_cuantos = 0 then
    raise exception 'El sistema no tiene nada en %: para meter existencia que no está en el sistema se usa la carga inicial',
      v_lugar;
  end if;
  if v_cuantos > 1 then
    raise exception 'En % hay % cosas: %. Escanea la matrícula del pallet que estás contando',
      v_lugar, v_cuantos, v_lista;
  end if;

  select * into s
  from hay_en(v_lugar) h
  where v_pallet is null or h.lpn_code = v_pallet;

  select pl.id, pl.qty_base_units into v_case, v_por_caja
  from packaging_level pl
  where pl.product_id = s.product_id and pl.code = 'CASE';

  if v_case is null then
    raise exception 'A % le falta el corrugado en el maestro: no se puede contar por cajas',
      s.sku;
  end if;

  v_nuevo := p_cajas * v_por_caja + v_sueltas;
  v_diff := v_nuevo - s.qty_base;

  if v_diff <> 0 then
    v_nota := coalesce(
      nullif(trim(coalesce(p_nota, '')), ''),
      'Recuento: el sistema decía ' || trim_scale(floor(s.qty_base / v_por_caja))
        || ' cajas y ' || trim_scale(mod(s.qty_base, v_por_caja)) || ' sueltas, y había '
        || trim_scale(p_cajas) || ' cajas y ' || trim_scale(v_sueltas) || ' sueltas'
    );
  end if;

  -- Baja la cantidad y hay surtido apartado sobre esto: hay que soltar lo que ya no existe
  -- antes de tocar el saldo, porque lo reservado no puede pasar de lo que hay.
  if v_diff < 0 and s.qty_allocated > v_nuevo then
    v_pendiente := s.qty_allocated - v_nuevo;

    for a in
      select al.id, al.qty_base, al.order_line_id, al.task_id, t.status, t.qty_base as tarea_qty
      from allocation al
      left join task t on t.id = al.task_id
      where al.stock_id = s.stock_id
      order by
        case coalesce(t.status::text, 'SIN')
          when 'READY' then 1 when 'SIN' then 2 when 'ASSIGNED' then 3 else 4
        end,
        al.created_at desc
    loop
      exit when v_pendiente <= 0;
      v_libera := least(v_pendiente, a.qty_base);

      if v_libera >= a.qty_base then
        delete from allocation where id = a.id;
        if a.task_id is not null then
          update task
          set status = 'CANCELLED', completed_at = now(),
              closed_reason = 'Recuento: ya no hay existencia en esa posición'
          where id = a.task_id and status <> 'DONE';
        end if;
      else
        update allocation set qty_base = qty_base - v_libera where id = a.id;
        if a.task_id is not null then
          update task set qty_base = greatest(a.tarea_qty - v_libera, 1)
          where id = a.task_id and status not in ('DONE', 'CANCELLED');
        end if;
      end if;

      update stock set qty_allocated = greatest(0, qty_allocated - v_libera)
      where id = s.stock_id;

      if a.order_line_id is not null and not (a.order_line_id = any (v_lineas)) then
        v_lineas := array_append(v_lineas, a.order_line_id);
      end if;

      v_pendiente := v_pendiente - v_libera;
    end loop;
  end if;

  if v_diff < 0 then
    v_mov := post_movement(
      'COUNT', s.product_id, -v_diff, s.location_id, null, s.lpn_id, s.lot, s.expiry_date,
      'AJUSTE_CNT', v_nota, v_case, p_task_id
    );
  elsif v_diff > 0 then
    v_mov := post_movement(
      'COUNT', s.product_id, v_diff, null, s.location_id, s.lpn_id, s.lot, s.expiry_date,
      'AJUSTE_CNT', v_nota, v_case, p_task_id
    );
  end if;

  insert into stock_count (
    location_id, product_id, lpn_id, lot, expiry_date, qty_expected, qty_found,
    counted_by, task_id, movement_id, note
  ) values (
    s.location_id, s.product_id, s.lpn_id, s.lot, s.expiry_date, s.qty_base, v_nuevo,
    auth.uid(), p_task_id, v_mov, nullif(trim(coalesce(p_nota, '')), '')
  );

  -- De dónde sacar lo que ya no está aquí. El motor es el mismo del surtido, con sus reglas:
  -- del almacén salen pallets completos y las cajas sueltas salen de picking.
  if array_length(v_lineas, 1) > 0 then
    select coalesce(array_agg(t.id), '{}'::uuid[]) into v_antes
    from task t
    join allocation al on al.task_id = t.id
    where al.order_line_id = any (v_lineas);

    foreach ol in array v_lineas loop
      v_tareas := v_tareas + apartar_linea(ol);
    end loop;

    select string_agg(
             l.code || ' (' || trim_scale(t.qty_base / v_por_caja) || ' cajas)', ', '
             order by l.code
           )
      into v_de_donde
    from task t
    join allocation al on al.task_id = t.id
    join location l on l.id = t.from_location_id
    where al.order_line_id = any (v_lineas) and not (t.id = any (v_antes));

    select coalesce(sum(
             greatest(
               0,
               li.qty_base
                 - coalesce((
                     select sum(x.qty_base) from allocation x where x.order_line_id = li.id
                   ), 0)
                 - coalesce((
                     select sum(c.qty_base) from order_crossdock c where c.order_line_id = li.id
                   ), 0)
             )
           ), 0) into v_falta
    from order_line li
    where li.id = any (v_lineas);
  end if;

  return query
  select
    floor(s.qty_base / v_por_caja),
    mod(s.qty_base, v_por_caja),
    p_cajas,
    v_sueltas,
    v_diff / v_por_caja,
    v_por_caja,
    v_tareas,
    v_de_donde,
    v_falta / v_por_caja;
end;
$$;

grant execute on function recontar to authenticated;


-- ---------------------------------------------------------------------------------------
-- destino_valido: fuera el parametro que nadie pasa
-- ---------------------------------------------------------------------------------------
--
-- Nacio con un `p_task_id` para perdonar la posicion apartada por la propia tarea, y con un
-- comentario que decia que guardar compartia estas comprobaciones. Ninguna de las dos cosas
-- es cierta: `complete_putaway` tiene su lista aparte y el unico que llama aqui es
-- `reordenar`, que no pasa tarea ninguna. Se queda lo que de verdad se usa.

drop function if exists destino_valido(text, uuid);

create or replace function destino_valido(p_codigo text)
returns location
language plpgsql stable security definer set search_path = public as $$
declare
  v_dest location;
begin
  select * into v_dest from location where code = upper(trim(coalesce(p_codigo, '')));
  if not found then
    raise exception 'No existe la posición %', p_codigo;
  end if;
  if v_dest.retired_at is not null or v_dest.status <> 'available' then
    raise exception 'La posición % no está disponible', v_dest.code;
  end if;
  if not exists (
    select 1 from location_usage u
    where u.code = v_dest.usage_code and u.holds_product and u.is_active
  ) then
    raise exception 'En % no va producto', v_dest.code;
  end if;
  if v_dest.reserved_by_task_id is not null then
    raise exception 'La posición % está apartada para otra tarea', v_dest.code;
  end if;
  return v_dest;
end;
$$;

grant execute on function destino_valido to authenticated;
