-- ---------------------------------------------------------------------------------------
-- Conteos: el recuento del dia a dia y los ciclicos que lanza el supervisor
-- ---------------------------------------------------------------------------------------
--
-- Hasta aqui el conteo era una idea: existian los tipos `COUNT` y el motivo `AJUSTE_CNT`, y
-- nada mas. Lo pedido son dos cosas distintas que comparten el mismo registro:
--
-- 1. **El recuento del dia a dia.** «Por si alguien va a sacar algo pero se da cuenta que hay
--    menos de lo que deberia.» El sistema dice 20 cajas, hay 10: la persona escanea el lugar y
--    cambia la cantidad. El sistema corrige el saldo, deja el historial con su nombre y **le
--    dice de donde sacar las otras 10**. Lo corrige cualquiera: el que esta ahi mirando el
--    pallet es el que sabe.
-- 2. **Los ciclicos del supervisor.** El jefe lanza un conteo de una zona o un area, las
--    tareas se reparten entre la gente que esta trabajando y a cada quien le toca un tramo
--    seguido del recorrido, no posiciones salteadas.
--
-- Lo que no esta: escoger por A, B o C. El ABC todavia no existe —se calcula de un pronostico
-- que no se ha importado—, asi que el filtro se lanza por zona, area y nivel, que es lo que
-- hay. El dia que exista el ABC se le suma un criterio mas a la misma funcion.

-- ---------------------------------------------------------------------------------------
-- El historial, que es de donde sale el porcentaje de inexactitud
-- ---------------------------------------------------------------------------------------

-- Un conteo que cuadra no mueve existencia, y por lo tanto no deja nada en el libro mayor.
-- Si el historial fuera el ledger no habria con que dividir: se sabrian los descuadres y no
-- cuantas veces se conto bien. Por eso cada conteo deja su fila aqui, cuadre o no.
create table if not exists stock_count (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references location on delete restrict,
  product_id uuid not null references product on delete restrict,
  lpn_id uuid references lpn on delete restrict,
  lot text,
  expiry_date date,
  qty_expected numeric(14, 3) not null check (qty_expected >= 0),
  qty_found numeric(14, 3) not null check (qty_found >= 0),
  counted_by uuid references auth.users on delete set null,
  counted_at timestamptz not null default now(),
  task_id uuid references task on delete set null,
  movement_id bigint references stock_movement on delete restrict,
  note text check (length(note) <= 500)
);

comment on table stock_count is
  'Cada recuento, cuadre o no. El denominador del porcentaje de inexactitud.';

create index if not exists stock_count_persona on stock_count (counted_by, counted_at desc);
create index if not exists stock_count_lugar on stock_count (location_id, counted_at desc);

alter table stock_count enable row level security;

drop policy if exists stock_count_lee on stock_count;
create policy stock_count_lee on stock_count for select to authenticated using (true);

grant select on stock_count to authenticated;

/** El historial legible: quien conto, donde, que decia el sistema y que habia. */
create or replace view recuentos as
  select
    c.id,
    c.counted_at,
    p.full_name as persona,
    l.code as posicion,
    lp.code as pallet,
    pr.sku,
    pr.name as producto,
    c.lot,
    c.expiry_date,
    c.qty_expected,
    c.qty_found,
    c.qty_found - c.qty_expected as diferencia,
    c.task_id,
    c.note
  from stock_count c
  join location l on l.id = c.location_id
  join product pr on pr.id = c.product_id
  left join lpn lp on lp.id = c.lpn_id
  left join profile p on p.id = c.counted_by;

grant select on recuentos to authenticated;

/**
 * El porcentaje de inexactitud, por persona.
 *
 * Son dos numeros distintos y los dos hacen falta: cuantas veces de las que conto encontro un
 * descuadre, y cuanto se desvio en unidades sobre todo lo que conto. El primero dice si le
 * toca inventario sucio; el segundo, de que tamano son los errores.
 */
create or replace view inexactitud as
  select
    c.counted_by as profile_id,
    p.full_name as persona,
    count(*) as conteos,
    count(*) filter (where c.qty_found <> c.qty_expected) as descuadres,
    round(
      100.0 * count(*) filter (where c.qty_found <> c.qty_expected) / count(*), 1
    ) as pct_conteos_con_descuadre,
    sum(abs(c.qty_found - c.qty_expected)) as unidades_de_diferencia,
    sum(c.qty_expected) as unidades_esperadas,
    case
      when sum(c.qty_expected) > 0 then round(
        100.0 * sum(abs(c.qty_found - c.qty_expected)) / sum(c.qty_expected), 1
      )
    end as pct_unidades,
    max(c.counted_at) as ultimo
  from stock_count c
  left join profile p on p.id = c.counted_by
  group by c.counted_by, p.full_name;

grant select on inexactitud to authenticated;

-- ---------------------------------------------------------------------------------------
-- El recuento
-- ---------------------------------------------------------------------------------------

/**
 * Rectifica lo que de verdad hay en una posicion o en un pallet.
 *
 * Se pasan **cajas**, que es lo que cuenta el operario; la conversion a unidades base vive
 * aqui, como en toda la aplicacion. Cero es una cantidad valida: una posicion que el sistema
 * cree llena y esta vacia es el descuadre que mas estorba.
 *
 * Lo que hace cuando baja la cantidad y habia surtido apartado sobre eso: suelta lo apartado
 * que sobra —cancelando la tarea que ya no se puede hacer, o recortandola a lo que si hay— y
 * vuelve a apartar la linea del pedido desde donde si haya. De ahi sale el «de donde sacar
 * las otras 10»: no es una consulta aparte, es el mismo motor que reparte el surtido.
 */
create or replace function recontar(
  p_lugar text,
  p_cajas numeric,
  p_pallet text default null,
  p_nota text default null,
  p_task_id uuid default null
) returns table (
  decia numeric,
  habia numeric,
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

  v_nuevo := p_cajas * v_por_caja;
  v_diff := v_nuevo - s.qty_base;

  if v_diff <> 0 then
    v_nota := coalesce(
      nullif(trim(coalesce(p_nota, '')), ''),
      'Recuento: el sistema decía ' || trim_scale(s.qty_base / v_por_caja)
        || ' cajas y había ' || trim_scale(p_cajas)
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
    s.qty_base / v_por_caja,
    p_cajas,
    v_diff / v_por_caja,
    v_por_caja,
    v_tareas,
    v_de_donde,
    v_falta / v_por_caja;
end;
$$;

grant execute on function recontar to authenticated;


-- ---------------------------------------------------------------------------------------
-- Los conteos ciclicos del supervisor
-- ---------------------------------------------------------------------------------------

/**
 * Las posiciones que toca contar, ya puestas en el orden del recorrido.
 *
 * Se cuentan las que **tienen existencia**: una posicion que el sistema cree vacia no tiene
 * nada que contar, y el descuadre al reves —hay producto donde el sistema no sabe— se atiende
 * con la carga inicial, no con un conteo.
 *
 * Mientras `pick_sequence` siga nulo en las 5,581 posiciones el recorrido es el orden del
 * codigo, que sigue el pasillo pero no sabe de atajos. Cuando se cargue la planimetria esta
 * misma consulta ordena de verdad, sin tocar nada mas.
 */
create or replace function posiciones_a_contar(
  p_zona text default null,
  p_area text default null,
  p_nivel integer default null
) returns table (location_id uuid, zone_id uuid, nivel smallint, paso integer)
language plpgsql stable security definer set search_path = public as $$
declare
  v_zona text := nullif(lower(trim(coalesce(p_zona, ''))), '');
  v_area text := nullif(upper(trim(coalesce(p_area, ''))), '');
  v_code text;
  v_kind zone_type;
begin
  if v_zona is null and v_area is null and p_nivel is null then
    raise exception 'Dime al menos una cosa: la zona, el área o el nivel';
  end if;

  if v_zona is not null then
    if exists (select 1 from zone where lower(code) = v_zona) then
      v_code := v_zona;
    elsif v_zona = any (enum_range(null::zone_type)::text[]) then
      v_kind := v_zona::zone_type;
    else
      raise exception 'No hay zona ni clase de zona que se llame %', p_zona;
    end if;
  end if;

  if v_area is not null and not exists (select 1 from area where code = v_area) then
    raise exception 'No hay ningún área que se llame %', p_area;
  end if;

  return query
  select
    l.id,
    la.zone_id,
    coalesce(l.level, 0)::smallint,
    row_number() over (order by l.pick_sequence nulls last, l.code)::integer
  from location l
  join lane la on la.id = l.lane_id
  join zone z on z.id = la.zone_id
  join location_usage u on u.code = l.usage_code
  where l.retired_at is null
    and u.holds_product
    and (v_code is null or lower(z.code) = v_code)
    and (v_kind is null or z.kind = v_kind)
    and (p_nivel is null or l.level = p_nivel)
    and (
      v_area is null
      or exists (
        select 1 from location_area lar
        join area ar on ar.id = lar.area_id
        where lar.location_id = l.id and lar.valid_to is null and ar.code = v_area
      )
    )
    and exists (select 1 from stock s where s.location_id = l.id and s.qty_base > 0)
    and not exists (
      select 1 from task t
      where t.from_location_id = l.id and t.type = 'COUNT'
        and t.status in ('READY', 'ASSIGNED', 'IN_PROGRESS')
    );
end;
$$;

grant execute on function posiciones_a_contar to authenticated;

/**
 * Lanza un conteo y lo reparte entre quien esta trabajando.
 *
 * El reparto: las posiciones se cortan en tantos tramos **seguidos** como gente haya
 * trabajando. Tramo seguido es lo que hace que nadie vuelva por donde ya paso.
 *
 * Solo entra en el reparto quien alcanza el nivel mas alto del conteo: un conteo de racks no
 * se le deja a quien anda a pie. Si no alcanza nadie —o no hay nadie trabajando— las tareas
 * quedan en la cola, donde `claim_next_task` ya mira el alcance de cada quien.
 */
create or replace function lanzar_conteo(
  p_zona text default null,
  p_area text default null,
  p_nivel integer default null
) returns table (tareas integer, personas integer, repartidas integer)
language plpgsql security definer set search_path = public as $$
declare
  v_max_nivel smallint;
  v_gente uuid[];
  v_n integer;
  v_tareas integer := 0;
  v_repartidas integer := 0;
begin
  if not has_role('supervisor', 'admin') then
    raise exception 'Sólo la supervisión lanza conteos';
  end if;

  select coalesce(max(c.nivel), 0) into v_max_nivel
  from posiciones_a_contar(p_zona, p_area, p_nivel) c;

  select coalesce(array_agg(sa.profile_id order by p.full_name), '{}'::uuid[]) into v_gente
  from shift_assignment sa
  join profile p on p.id = sa.profile_id
  where sa.ended_at is null
    and sa.paused_at is null
    and es_rol_de_trabajo(rol_de_trabajo(sa.profile_id))
    and alcance_de(sa.profile_id) >= v_max_nivel;

  v_n := coalesce(array_length(v_gente, 1), 0);

  with ruta as (
    select c.location_id, c.zone_id, c.nivel, c.paso, count(*) over () as total
    from posiciones_a_contar(p_zona, p_area, p_nivel) c
  ),
  nueva as (
    insert into task (
      type, status, priority, from_location_id, zone_id, min_level, assigned_to, assigned_at
    )
    select
      'COUNT',
      case when v_n > 0 then 'ASSIGNED'::task_status else 'READY'::task_status end,
      150,
      r.location_id,
      r.zone_id,
      r.nivel,
      case
        when v_n > 0
        then v_gente[(1 + ((r.paso - 1) * v_n) / greatest(r.total, 1))::integer]
      end,
      case when v_n > 0 then now() end
    from ruta r
    returning assigned_to
  )
  select count(*)::integer, count(assigned_to)::integer into v_tareas, v_repartidas from nueva;

  if v_tareas = 0 then
    raise exception 'Ahí no hay nada que contar: o no hay existencia, o el conteo ya está lanzado';
  end if;

  return query select v_tareas, v_n, v_repartidas;
end;
$$;

grant execute on function lanzar_conteo to authenticated;

/** Cierra la tarea de conteo: lo que habia ya quedo escrito con cada recuento. */
create or replace function cerrar_conteo(p_task_id uuid) returns task
language plpgsql security definer set search_path = public as $$
declare
  v_task task;
begin
  update task
  set status = 'DONE',
      completed_at = now(),
      started_at = coalesce(started_at, now())
  where id = p_task_id and assigned_to = auth.uid()
    and type = 'COUNT' and status in ('ASSIGNED', 'IN_PROGRESS')
  returning * into v_task;

  if not found then
    raise exception 'Esa tarea de conteo no es tuya o ya está cerrada';
  end if;

  return v_task;
end;
$$;

grant execute on function cerrar_conteo to authenticated;

/** Los conteos pendientes, en el orden del recorrido. La pantalla filtra por quien pregunta. */
create or replace view conteos_pendientes as
  select
    t.id as task_id,
    t.status,
    t.assigned_to,
    t.created_at,
    l.id as location_id,
    l.code as posicion,
    z.name as zona,
    l.level as nivel,
    l.pick_sequence
  from task t
  join location l on l.id = t.from_location_id
  join lane la on la.id = l.lane_id
  join zone z on z.id = la.zone_id
  where t.type = 'COUNT' and t.status in ('READY', 'ASSIGNED', 'IN_PROGRESS');

grant select on conteos_pendientes to authenticated;
