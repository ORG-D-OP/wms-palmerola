/**
 * Estado posicion por posicion, para que el plano diga la verdad.
 *
 * El mapa 2D y el 3D pintaban todas las posiciones de una zona con el mismo tono: el
 * promedio de la zona. Es decir, con 594 posiciones en F3 y 200 ocupadas, las 594 salian
 * al 34%. Parecia dato y no lo era: nadie podia ver cual posicion estaba ocupada, que es
 * justo lo que uno va a buscar al tablero.
 *
 * Devuelve solo las posiciones que NO estan libres, que son las pocas que el mapa necesita
 * pintar distinto. Con la bodega vacia son cero filas; con la bodega llena, 5,581 codigos
 * cortos, que es lo que cuesta decir la verdad.
 *
 * El orden de precedencia importa: una posicion con producto se pinta ocupada aunque
 * tambien este apartada por una tarea de salida.
 */
create view posicion_estado as
  select
    l.code,
    case
      when e.location_id is not null then 'OCUPADA'
      when not coalesce(u.holds_product, true) then 'OTRO_USO'
      else 'APARTADA'
    end as estado
  from location l
  join lane la on la.id = l.lane_id
  join zone z on z.id = la.zone_id
  join location_usage u on u.code = l.usage_code
  left join (select distinct location_id from stock where qty_base > 0) e
    on e.location_id = l.id
  where l.retired_at is null
    and z.kind in ('floor', 'rack')
    and (
      e.location_id is not null
      or l.reserved_by_task_id is not null
      or not coalesce(u.holds_product, true)
    );

grant select on posicion_estado to authenticated;
