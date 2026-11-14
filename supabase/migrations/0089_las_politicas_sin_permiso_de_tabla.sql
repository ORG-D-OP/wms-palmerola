/**
 * Cinco tablas con su política de lectura puesta y **sin el permiso de tabla**, que es el mismo
 * olvido del registro —la 0083— encontrado otra vez, y ahora buscado a propósito.
 *
 * En este proyecto el permiso de tabla se da a mano, tabla por tabla, y la política de RLS se
 * escribe aparte. Cuando se escribe una y se olvida el otro, la tabla queda ilegible para todo
 * el mundo y **no se nota**: todo lo que la lee pasa por funciones `security definer`, que no
 * miran permisos. Hasta que algo la lee sin función, y ahí revienta.
 *
 * Reventó así. La 0084 metió `camion_completo` dentro de `kpi_despacho_dia`, y una función
 * normal dentro de una vista corre **con los permisos del que pregunta**. La pantalla de
 * Indicadores se quedó sin el día entero:
 *
 *     42501  permission denied for table order_crossdock
 *     HINT   GRANT SELECT ON public.order_crossdock TO authenticated;
 *
 * Las cinco tienen la misma política —`for select to authenticated using (true)`—, así que el
 * permiso que falta es exactamente eso y nada más. Lo que se busca con esto no es arreglar las
 * cinco: es que la próxima no tarde en aparecer. Hay una comprobación que las cuenta.
 *
 * *(Dos de ellas traen además una política de escritura para supervisor y admin, y tampoco
 * tienen el permiso de escritura. Eso se queda como está: hoy nada escribe sin pasar por una
 * función, así que dárselo sería abrir una puerta que nadie ha pedido.)*
 */
grant select on public.inbound_pallet to authenticated;
grant select on public.order_crossdock to authenticated;
grant select on public.packaging_form to authenticated;
grant select on public.returnable_count to authenticated;
grant select on public.returnable_movement to authenticated;

/**
 * Y las dos funciones que la vista llama se vuelven `security definer`, que es lo que son: una
 * cuenta de lo que salió de una línea. No enseñan nada que la pantalla del despacho no enseñe
 * ya, y así el día de los indicadores no se vuelve a quedar en blanco porque a una tabla de más
 * abajo le falte un permiso.
 */
create or replace function surtido_de_linea(p_order_line_id uuid) returns numeric
language sql stable security definer set search_path = public as $f$
  select coalesce((
    select sum(sm.qty_base) from allocation a
    join stock_movement sm on sm.task_id = a.task_id and sm.type = 'PICK'
    where a.order_line_id = p_order_line_id
  ), 0)
  + coalesce((
    select sum(c.qty_base) from order_crossdock c where c.order_line_id = p_order_line_id
  ), 0);
$f$;

grant execute on function surtido_de_linea to authenticated;

create or replace function camion_completo(p_order_id uuid) returns boolean
language sql stable security definer set search_path = public as $f$
  select not exists (
    select 1 from order_line l
    where l.order_id = p_order_id
      and coalesce(l.checked_qty_base, surtido_de_linea(l.id)) < l.qty_base
  );
$f$;

grant execute on function camion_completo to authenticated;
