/**
 * El pallet que trae más de un producto.
 *
 * Los archivos no lo delatan: en la ZRDN las 10,527 matrículas traen un material, un lote y un
 * vencimiento cada una, y la ZMB51 no habla de pallets. Así que un mixto **se descubre en el
 * andén**, y por eso vive en el ingreso a ciegas y no en el ingreso contra documento.
 *
 * Y se desarma: del almacén sólo salen pallets completos de un producto, así que un mixto no
 * puede quedarse entero. Lo que hace esta función es desarmarlo **ahí mismo**, en el andén, que
 * es donde ya están las manos puestas: cada producto sale como su propio pallet, con su
 * matrícula, su posición sugerida y su tarea de guardar. Queda la madre —la etiqueta física que
 * traía el camión, o una propia si no traía ninguna— sin saldo, colgando de ella las hijas por
 * `parent_id`, que es para lo que la matrícula es anidada desde la 0021. De ahí sale la
 * pregunta «¿en qué pallet vino esto?» mucho después.
 *
 * Lo que todavía no hace: dejar el mixto entero esperando cuando picking está lleno, con una
 * cantidad pendiente de desarme y prioridad cuando se libere un hueco. Eso es otra cosa, con su
 * propia cola.
 */
create or replace function recibir_mixto(
  p_pedido text,
  p_productos jsonb,
  p_dock_location_id uuid,
  p_pallet_code text default null,
  p_max_level smallint default null
) returns table (
  madre text,
  lpn_code text,
  to_location_code text,
  sku text,
  product_name text,
  cases numeric,
  recibidos integer,
  pallets integer
)
language plpgsql security definer set search_path = public as $$
declare
  v_doc inbound_doc;
  v_madre lpn;
  v_matricula text;
  v_propia boolean;
  v_item jsonb;
  v_prod record;
  v_res record;
  v_hija text;
  v_lote text;
  v_vence date;
  v_cajas numeric;
  v_linea smallint;
  v_cuenta record;
  v_salida jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Hace falta una sesión para recibir';
  end if;

  if p_productos is null or jsonb_typeof(p_productos) <> 'array'
     or jsonb_array_length(p_productos) < 2 then
    raise exception 'Un pallet mixto lleva al menos dos productos. Si trae uno solo, recíbelo normal';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_productos) e
    group by e->>'codigo', coalesce(e->>'lot', ''), e->>'expiry'
    having count(*) > 1
  ) then
    raise exception 'Ese producto ya está en el pallet con el mismo lote y vencimiento';
  end if;

  select * into v_doc from inbound_doc where pedido = trim(p_pedido) for update;
  if not found then
    raise exception 'No hay ningún ingreso con el código %', trim(p_pedido);
  end if;
  if not v_doc.sin_aviso then
    raise exception 'El ingreso % tiene documento: recibe escaneando los pallets de la lista',
      v_doc.pedido;
  end if;
  if v_doc.status in ('CLOSED', 'CANCELLED') then
    raise exception 'El ingreso % ya está cerrado', v_doc.pedido;
  end if;

  v_matricula := nullif(trim(coalesce(p_pallet_code, '')), '');
  v_propia := v_matricula is null;
  if v_propia then
    v_matricula := 'WMS-' || lpad(nextval('matricula_wms_seq')::text, 8, '0');
  end if;
  if exists (select 1 from lpn where code = v_matricula) then
    raise exception 'El pallet % ya está en el sistema', v_matricula;
  end if;

  -- La madre no lleva saldo: el producto cuelga de las hijas, una por cada cosa que traía.
  insert into lpn (code, created_by, level, source)
  values (v_matricula, auth.uid(), 'PALLET',
          case when v_propia then 'PROVISIONAL' else 'NEST' end)
  returning * into v_madre;

  for v_item in select * from jsonb_array_elements(p_productos) loop
    v_cajas := nullif(v_item->>'cases', '')::numeric;
    if v_cajas is null or v_cajas <= 0 then
      raise exception 'Escribe cuántas cajas trae cada producto';
    end if;

    v_vence := nullif(v_item->>'expiry', '')::date;
    if v_vence is null then
      raise exception 'Escribe el vencimiento de cada producto: sin él no hay FEFO';
    end if;
    v_lote := nullif(trim(coalesce(v_item->>'lot', '')), '');

    select * into v_prod from producto_para_recibir(v_item->>'codigo');
    if v_prod.case_id is null then
      raise exception 'A % le falta el corrugado en el maestro: no se puede recibir por cajas',
        v_prod.sku;
    end if;

    v_hija := 'WMS-' || lpad(nextval('matricula_wms_seq')::text, 8, '0');

    select * into v_res from receive_pallet(
      v_hija, v_prod.product_id, v_prod.case_id, v_cajas, p_dock_location_id,
      v_lote, v_vence, null, p_max_level
    );

    -- La hija la inventa el WMS, y cuelga de la etiqueta que de verdad venía en el camión.
    update lpn set parent_id = v_madre.id, source = 'PROVISIONAL' where id = v_res.lpn_id;

    select coalesce(max(line_no), 0) + 1 into v_linea from inbound_line where doc_id = v_doc.id;

    insert into inbound_line (doc_id, line_no, product_id, qty_cases, lot, expiry_date)
    values (v_doc.id, v_linea, v_prod.product_id, v_cajas, v_lote, v_vence);

    insert into inbound_pallet (
      doc_id, pallet_code, product_id, qty_cases, lot, expiry_date, received_lpn_id, received_at
    )
    values (
      v_doc.id, v_hija, v_prod.product_id, v_cajas, v_lote, v_vence, v_res.lpn_id, now()
    );

    v_salida := v_salida || jsonb_build_object(
      'lpn_code', v_res.lpn_code,
      'to_location_code', v_res.to_location_code,
      'sku', v_prod.sku,
      'product_name', v_prod.name,
      'cases', v_cajas
    );
  end loop;

  update inbound_doc set status = 'RECEIVING' where id = v_doc.id and status <> 'RECEIVING';

  select count(*)::integer as total, count(received_at)::integer as hechos
  into v_cuenta
  from inbound_pallet where doc_id = v_doc.id;

  return query
  select v_madre.code, x.lpn_code, x.to_location_code, x.sku, x.product_name, x.cases,
         v_cuenta.hechos, v_cuenta.total
  from jsonb_to_recordset(v_salida)
    as x(lpn_code text, to_location_code text, sku text, product_name text, cases numeric);
end;
$$;

grant execute on function recibir_mixto to authenticated;

/** Qué vino en el mismo pallet físico: la pregunta que la madre contesta mucho después. */
create or replace function hermanas_del_pallet(p_lpn_code text)
returns table (lpn_code text, sku text, product_name text, posicion text, qty_base numeric)
language sql stable security definer set search_path = public as $$
  with yo as (
    select id, coalesce(parent_id, id) as madre from lpn where code = trim(p_lpn_code)
  )
  select l.code, p.sku, p.name, loc.code, s.qty_base
  from yo
  join lpn l on l.parent_id = yo.madre
  join stock s on s.lpn_id = l.id and s.qty_base > 0
  join product p on p.id = s.product_id
  join location loc on loc.id = s.location_id
  order by p.sku;
$$;

grant execute on function hermanas_del_pallet to authenticated;
