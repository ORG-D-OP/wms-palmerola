/**
 * Las areas se van a redibujar seguido.
 *
 * La planimetria, el ABC y la distribucion de los productos cambian cada semana, asi que
 * declarar el picking no es algo que se haga una vez al arrancar: es mantenimiento. Hasta aqui
 * la unica forma de agarrar un rango era el principio del codigo, y hay dos cosas que la
 * bodega dice todos los dias y el codigo no sabe decir:
 *
 *   «el piso bajo de los racks»  ->  nivel 1, pero el nivel va en medio del codigo
 *                                    (R-ABA-L01-B01-N1-P1), asi que ningun prefijo lo agarra
 *   «todo el piso»               ->  siete zonas distintas, siete enunciados
 *   «las lineas de la orilla»    ->  catorce lineas sueltas, catorce enunciados
 *
 * Asi que el rango pasa a declararse por criterios —codigo, zona y nivel—, y el prefijo es uno
 * de ellos para que no haya dos caminos. Los tres son opcionales y se cruzan; lo que no se diga
 * no filtra. Y el codigo admite varios separados por coma, porque un conjunto de posiciones que
 * no es un rango —la orilla de los pasillos— se nombra enumerando. Seguir viendo antes de
 * cambiar sigue siendo la regla: la pantalla cuenta primero.
 */

/** El nivel y el carril, que la pantalla necesita mostrar para que el rango se entienda. */
create or replace view posicion_detalle as
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
    exists (select 1 from stock s where s.location_id = l.id and s.qty_base > 0) as ocupada,
    l.level,
    la.code as lane_code
  from location l
  join lane la on la.id = l.lane_id
  join zone z on z.id = la.zone_id
  join location_usage u on u.code = l.usage_code
  left join location_area lar on lar.location_id = l.id and lar.valid_to is null
  left join area a on a.id = lar.area_id
  where l.retired_at is null;

grant select on posicion_detalle to authenticated;

/**
 * Las posiciones que cumplen los criterios que se den. Al menos uno hace falta: sin ninguno uno
 * se llevaria las 5,581 posiciones de un solo enunciado sin darse cuenta, y por lo mismo cada
 * codigo sigue exigiendo tres caracteres.
 *
 * `p_zona` admite el codigo de una zona (F1, R-ABA) o la clase de zona (rack, floor, staging),
 * porque de las dos maneras se habla: «F3» y «los racks».
 *
 * `p_patron` admite varios codigos separados por coma, punto y coma o espacio. Cada uno agarra
 * lo que empieza con el, y la union es el rango.
 */
create or replace function posiciones_donde(
  p_patron text default null,
  p_zona text default null,
  p_nivel integer default null
) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare
  v_patron text := nullif(upper(trim(coalesce(p_patron, ''))), '');
  v_zona text := nullif(lower(trim(coalesce(p_zona, ''))), '');
  v_patrones text[];
  v_code text;
  v_kind zone_type;
  v_ids uuid[];
begin
  if v_patron is null and v_zona is null and p_nivel is null then
    raise exception 'Dime al menos una cosa: el código, la zona o el nivel';
  end if;

  if v_patron is not null then
    select array_agg(x || '%') into v_patrones
    from unnest(regexp_split_to_array(v_patron, '[,;[:space:]]+')) as x
    where x <> '';

    if v_patrones is null then
      raise exception 'Escribe al menos tres caracteres del código de la posición';
    end if;
    -- El '%' ya va pegado, asi que tres caracteres de codigo son cuatro de patron.
    if exists (select 1 from unnest(v_patrones) as x where length(x) < 4) then
      raise exception 'Escribe al menos tres caracteres del código de la posición';
    end if;
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

  select array_agg(l.id) into v_ids
  from location l
  join lane la on la.id = l.lane_id
  join zone z on z.id = la.zone_id
  where l.retired_at is null
    and (v_patrones is null or l.code like any (v_patrones))
    and (v_code is null or lower(z.code) = v_code)
    and (v_kind is null or z.kind = v_kind)
    and (p_nivel is null or l.level = p_nivel);

  if v_ids is null then
    raise exception 'Ninguna posición cumple eso';
  end if;

  return v_ids;
end;
$$;

/** El rango por codigo es el caso de un solo criterio. */
create or replace function posiciones_como(p_patron text) returns uuid[]
language sql stable security definer set search_path = public as $$
  select posiciones_donde(p_patron);
$$;

/**
 * Mover de area y cambiar el uso, por criterios. El area va primero porque es el unico
 * obligatorio: los criterios se omiten.
 *
 * Mover de area una posicion con producto encima **se permite a proposito**: es justo el caso
 * de la semana, cuando el picking se redibuja con la bodega llena. Cambiar el **uso** no, y esa
 * guarda se queda donde esta: declarar «aqui va corrugado» una posicion con un pallet dentro la
 * saca del inventario a la vista del motor sin que el pallet se haya movido.
 */
create or replace function reasignar_area_donde(
  p_area_code text,
  p_patron text default null,
  p_zona text default null,
  p_nivel integer default null
) returns integer
language sql security definer set search_path = public as $$
  select reasignar_area(posiciones_donde(p_patron, p_zona, p_nivel), p_area_code);
$$;

create or replace function reasignar_uso_donde(
  p_usage_code text,
  p_patron text default null,
  p_zona text default null,
  p_nivel integer default null
) returns integer
language sql security definer set search_path = public as $$
  select reasignar_uso(posiciones_donde(p_patron, p_zona, p_nivel), p_usage_code);
$$;

grant execute on function posiciones_donde, reasignar_area_donde, reasignar_uso_donde
  to authenticated;
