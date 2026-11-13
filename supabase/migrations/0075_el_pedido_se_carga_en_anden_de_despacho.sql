/**
 * Un pedido se carga en un andén de despacho, y hasta hoy nadie lo comprobaba.
 *
 * Probándolo contra la base real salió esto: de los 24 pedidos de prueba, **los 24 estaban
 * puestos en un andén que no despacha** —seis en recepción, dos en la jaula de devoluciones y
 * catorce en andenes apagados—. Y uno de ellos ya había dejado un pallet de 485 unidades en la
 * posición del andén 9, que es de recepción, donde no lo busca nadie.
 *
 * El error era del generador de datos sintéticos, que repartía los pedidos entre los primeros
 * catorce andenes por orden de código y con la numeración vieja esos eran justo los de
 * entrada. Pero el generador sólo lo destapó: la base aceptaba el disparate sin chistar, y
 * mañana lo aceptaría igual de la mano de quien cree un pedido a mano.
 *
 * Así que queda apuntado donde no se puede saltar: un pedido sólo puede apuntar a un andén
 * activo cuyo oficio sea de salida. Los dos oficios de salida son mayoreo y cross.
 */
create or replace view anden_de_carga as
select
  l.id as location_id,
  d.id as dock_door_id,
  d.code as anden,
  p.code as oficio_code,
  p.name as oficio
from dock_door d
join dock_purpose p on p.code = d.purpose_code
join location l on l.code = 'STG-' || d.code and l.retired_at is null
where d.is_active and p.direction = 'outbound';

comment on view anden_de_carga is
  'Los andenes por donde sale un camión, con la posición donde se consolida lo surtido.';

grant select on anden_de_carga to authenticated;

/**
 * El aviso dice el oficio del andén, no sólo que está mal, porque quien se equivoca de andén
 * casi siempre se equivocó de número y le basta con que le digan qué hay en ese número.
 */
create or replace function pedido_en_anden_de_carga()
returns trigger language plpgsql as $$
declare
  v_anden text;
  v_oficio text;
begin
  if new.dock_door_id is null then
    return new;
  end if;

  select d.code, coalesce(p.name, 'un andén que todavía no se usa')
    into v_anden, v_oficio
  from dock_door d
  left join dock_purpose p on p.code = d.purpose_code
  where d.id = new.dock_door_id
    -- El `coalesce` no es adorno: sin oficio, `p.direction` es nulo y la condición entera
    -- saldría nula, que aquí se comporta como un sí.
    and not (d.is_active and coalesce(p.direction = 'outbound', false));

  if not found then
    return new;
  end if;

  raise exception 'El % es %. Un pedido se carga en un andén de despacho.',
    coalesce(v_anden, 'andén'), lower(v_oficio);
end;
$$;

drop trigger if exists pedido_en_anden_de_carga on sales_order;
create trigger pedido_en_anden_de_carga
  before insert or update of dock_door_id on sales_order
  for each row execute function pedido_en_anden_de_carga();
