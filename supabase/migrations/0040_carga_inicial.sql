/**
 * El día uno: la bodega está vacía y hay que meterle todo, pieza por pieza.
 *
 * No es un ingreso. No hay tabulado, no hay documento que anunciar, no hay contra qué
 * cuadrar y no hay camión en el andén: hay producto que ya está adentro y un sistema que
 * todavía no sabe nada. Por eso no pasa por `receive_pallet` —que deja la carga en el andén
 * y genera una tarea de guardado para alguien— sino que coloca directo en la posición.
 *
 * El orden de carga importa y es al revés de lo que uno diría: **primero lo más próximo a
 * vencer**, porque eso es lo que va a salir primero y tiene que quedar en picking y en los
 * niveles bajos. Si se carga al revés, el FEFO nace invertido y toca reacomodar la bodega
 * entera antes de despachar el primer camión. La pantalla sugiere posición y enseña lo que
 * ya se cargó de ese producto con sus vencimientos, para que eso se vea mientras se hace.
 */

insert into reason_code (code, name, description, category, affects_inventory, sort_order)
values (
  'CARGA_INICIAL',
  'Carga inicial de la bodega',
  'Producto que ya estaba adentro cuando el WMS empezó a funcionar. No viene de un camión.',
  'AJUSTE',
  true,
  5
)
on conflict (code) do nothing;

/**
 * Dónde pondría el sistema este producto. Es una sugerencia: la posición se puede cambiar.
 *
 * El primer pallet de cada producto va a picking, y por eso el orden de carga tiene que ser
 * del que vence antes al que vence después: así el que queda a la mano es el que sale
 * primero y el FEFO nace derecho. Del segundo en adelante va a almacén, que es el motor
 * normal de guardado. Si todavía no hay picking definido —nace vacía, la arma el jefe de
 * bodega— cae a almacén sin quejarse.
 */
create or replace function sugerir_posicion_inicial(
  p_codigo text,
  p_expiry date default null
) returns table (location_id uuid, code text, es_picking boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_prod record;
  v_id uuid;
begin
  select * into v_prod from producto_para_recibir(p_codigo);

  if not exists (
    select 1
    from stock s
    join location_area lar on lar.location_id = s.location_id and lar.valid_to is null
    join area a on a.id = lar.area_id and a.code = 'PICKING'
    where s.product_id = v_prod.product_id and s.qty_base > 0
  ) then
    select l.id into v_id
    from location l
    join location_usage u on u.code = l.usage_code
    join location_area lar on lar.location_id = l.id and lar.valid_to is null
    join area a on a.id = lar.area_id
    where a.code = 'PICKING'
      and a.is_active
      and u.holds_product
      and l.retired_at is null
      and l.status = 'available'
      and l.reserved_by_task_id is null
      and not exists (select 1 from stock s where s.location_id = l.id and s.qty_base > 0)
    order by coalesce(l.level, 0), l.code
    limit 1;

    if v_id is not null then
      return query select l.id, l.code, true from location l where l.id = v_id;
      return;
    end if;
  end if;

  v_id := suggest_putaway_location(v_prod.product_id, null, p_expiry);
  return query select l.id, l.code, false from location l where l.id = v_id;
end;
$$;

grant execute on function sugerir_posicion_inicial to authenticated;

/** Lo que ya se cargó de un producto, del que vence antes al que vence después. */
create or replace function carga_inicial_de(p_codigo text)
returns table (posicion text, lote text, vence date, cajas numeric, en_picking boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_prod record;
begin
  select * into v_prod from producto_para_recibir(p_codigo);

  return query
  select
    l.code,
    s.lot,
    s.expiry_date,
    trim_scale(s.qty_base / coalesce(pl.qty_base_units, 1)),
    coalesce(a.code = 'PICKING', false)
  from stock s
  join location l on l.id = s.location_id
  left join packaging_level pl on pl.product_id = s.product_id and pl.code = 'CASE'
  left join location_area lar on lar.location_id = l.id and lar.valid_to is null
  left join area a on a.id = lar.area_id
  where s.product_id = v_prod.product_id and s.qty_base > 0
  order by s.expiry_date nulls last, l.code;
end;
$$;

grant execute on function carga_inicial_de to authenticated;

/**
 * Coloca producto directo en su posición, sin camión y sin tarea de guardado.
 *
 * Queda como ajuste con motivo CARGA_INICIAL: el libro mayor dice que esas unidades no
 * entraron por un andén, que es la verdad, y se pueden separar de todo lo demás el día que
 * alguien pregunte de dónde salió el inventario de la bodega.
 */
create or replace function cargar_inicial(
  p_codigo text,
  p_qty_cases numeric,
  p_posicion text,
  p_lot text,
  p_expiry date,
  p_pallet_code text default null
) returns table (
  posicion text,
  sku text,
  product_name text,
  cases numeric,
  matricula text,
  aviso text
)
language plpgsql security definer set search_path = public as $$
declare
  v_prod record;
  v_loc record;
  v_lote text;
  v_matricula text;
  v_lpn lpn;
  v_por_caja numeric;
  v_picking record;
  v_aviso text;
begin
  if not has_role('auxiliar', 'chequeador', 'montacargista', 'inventarios', 'supervisor', 'admin')
  then
    raise exception 'No tienes permiso para cargar inventario';
  end if;

  if p_qty_cases is null or p_qty_cases <= 0 then
    raise exception 'Escribe cuántas cajas hay';
  end if;

  v_lote := nullif(trim(coalesce(p_lot, '')), '');
  if v_lote is null then
    raise exception 'Escribe el lote';
  end if;
  if p_expiry is null then
    raise exception 'Escribe el vencimiento: de ahí sale el FEFO de toda la bodega';
  end if;

  select * into v_prod from producto_para_recibir(p_codigo);
  if v_prod.case_id is null then
    raise exception 'A % le falta el corrugado en el maestro: no se puede contar por cajas',
      v_prod.sku;
  end if;

  select l.id, l.code, l.retired_at, u.holds_product
  into v_loc
  from location l
  join location_usage u on u.code = l.usage_code
  where l.code = trim(p_posicion) or l.barcode = trim(p_posicion);

  if not found then
    raise exception 'No hay ninguna posición con el código %', trim(p_posicion);
  end if;
  if v_loc.retired_at is not null then
    raise exception 'La posición % está dada de baja', v_loc.code;
  end if;
  if not v_loc.holds_product then
    raise exception 'La posición % no guarda producto', v_loc.code;
  end if;

  v_matricula := nullif(trim(coalesce(p_pallet_code, '')), '');
  if v_matricula is null then
    v_matricula := 'WMS-' || lpad(nextval('matricula_wms_seq')::text, 8, '0');
  end if;

  if exists (select 1 from lpn where code = v_matricula) then
    raise exception 'El pallet % ya está en el sistema', v_matricula;
  end if;

  insert into lpn (code, created_by, level, source)
  values (
    v_matricula, auth.uid(), 'PALLET',
    case when p_pallet_code is null then 'PROVISIONAL' else 'NEST' end
  )
  returning * into v_lpn;

  select qty_base_units into v_por_caja from packaging_level where id = v_prod.case_id;

  perform post_movement(
    'ADJUST', v_prod.product_id, p_qty_cases * v_por_caja, null, v_loc.id, v_lpn.id,
    v_lote, p_expiry, 'CARGA_INICIAL', null, v_prod.case_id, null, null,
    'inicial-' || v_lpn.id::text
  );

  -- El único error de la carga inicial que cuesta trabajo deshacer: dejar en picking un lote
  -- que vence después que otro guardado en almacén. El FEFO nace invertido y hay que bajar
  -- pallets de rack antes de despachar el primer camión. Se avisa en el momento, no después.
  select l.code as posicion, s.expiry_date as vence
  into v_picking
  from stock s
  join location l on l.id = s.location_id
  join location_area lar on lar.location_id = l.id and lar.valid_to is null
  join area a on a.id = lar.area_id and a.code = 'PICKING'
  where s.product_id = v_prod.product_id and s.qty_base > 0 and s.expiry_date is not null
  order by s.expiry_date
  limit 1;

  if v_picking.vence is not null and p_expiry < v_picking.vence then
    v_aviso := format(
      'Este lote vence el %s y en picking (%s) hay uno que vence el %s: este debería ir a picking.',
      to_char(p_expiry, 'DD/MM/YYYY'),
      v_picking.posicion,
      to_char(v_picking.vence, 'DD/MM/YYYY')
    );
  end if;

  return query select v_loc.code, v_prod.sku, v_prod.name, p_qty_cases, v_lpn.code, v_aviso;
end;
$$;

grant execute on function cargar_inicial to authenticated;
