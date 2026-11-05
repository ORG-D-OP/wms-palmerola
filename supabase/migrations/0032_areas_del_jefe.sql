/**
 * Lo que el jefe de bodega necesita para definir la bodega sin tocar la base.
 *
 * El picking nacio vacio a proposito: nadie sabe todavia cuales posiciones se van a surtir
 * a mano. Y hay posiciones que no guardan producto —ramplas, corrugado de retorno, pallets
 * vacios— que el motor de ubicacion tiene que dejar en paz. Las dos cosas se declaran por
 * rango de codigo, que es como se habla de la bodega: «la primera columna de F1», «el
 * carril L01 de abarrotes».
 */

/** Una fila por posicion con su area, su uso y si tiene algo encima. */
create view posicion_detalle as
  select
    l.id,
    l.code,
    z.code as zone_code,
    z.kind as zone_kind,
    l.usage_code,
    u.name as usage_name,
    u.holds_product,
    a.code as area_code,
    a.name as area_name,
    l.reserved_by_task_id is not null as apartada,
    exists (select 1 from stock s where s.location_id = l.id and s.qty_base > 0) as ocupada
  from location l
  join lane la on la.id = l.lane_id
  join zone z on z.id = la.zone_id
  join location_usage u on u.code = l.usage_code
  left join location_area lar on lar.location_id = l.id and lar.valid_to is null
  left join area a on a.id = lar.area_id
  where l.retired_at is null;

grant select on posicion_detalle to authenticated;

/**
 * Las posiciones de un rango de codigo. Exige tres caracteres: con el patron vacio uno se
 * llevaria las 5,581 posiciones de un solo enunciado sin darse cuenta.
 */
create function posiciones_como(p_patron text) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare
  v_patron text := upper(trim(coalesce(p_patron, '')));
  v_ids uuid[];
begin
  if length(v_patron) < 3 then
    raise exception 'Escribe al menos tres caracteres del código de la posición';
  end if;

  select array_agg(l.id) into v_ids
  from location l
  where l.retired_at is null and l.code like v_patron || '%';

  if v_ids is null then
    raise exception 'Ninguna posición empieza con %', v_patron;
  end if;

  return v_ids;
end;
$$;

/** Mueve de area por rango de codigo: es la forma en que el jefe define el picking. */
create function reasignar_area_por_codigo(p_patron text, p_area_code text) returns integer
language sql security definer set search_path = public as $$
  select reasignar_area(posiciones_como(p_patron), p_area_code);
$$;

/**
 * Cambia para que sirve un rango de posiciones. Si tiene producto encima no se cambia:
 * declarar «aqui va corrugado» una posicion con un pallet dentro la saca del inventario
 * a la vista del motor sin que el pallet se haya movido.
 */
create function reasignar_uso(p_location_ids uuid[], p_usage_code text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_ocupadas integer;
  v_n integer;
begin
  if not has_role('supervisor', 'admin') then
    raise exception 'Solo el jefe de bodega cambia el uso de las posiciones';
  end if;

  if not exists (select 1 from location_usage where code = p_usage_code and is_active) then
    raise exception 'El uso % no existe', p_usage_code;
  end if;

  select count(*) into v_ocupadas
  from location l
  where l.id = any(p_location_ids)
    and l.usage_code <> p_usage_code
    and (
      exists (select 1 from stock s where s.location_id = l.id and s.qty_base > 0)
      or l.reserved_by_task_id is not null
    );

  if v_ocupadas > 0 then
    raise exception 'Hay % posiciones con producto o apartadas: vacíalas primero', v_ocupadas;
  end if;

  update location set usage_code = p_usage_code
  where id = any(p_location_ids) and usage_code <> p_usage_code;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create function reasignar_uso_por_codigo(p_patron text, p_usage_code text) returns integer
language sql security definer set search_path = public as $$
  select reasignar_uso(posiciones_como(p_patron), p_usage_code);
$$;

grant execute on function posiciones_como, reasignar_area_por_codigo, reasignar_uso,
  reasignar_uso_por_codigo to authenticated;
