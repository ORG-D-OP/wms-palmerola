/**
 * El escaneo congelaba la cantidad, y una línea casi nunca baja de un solo viaje.
 *
 * El reparto parte cada línea en varias tareas —una por pallet entero y otra por el resto—, y
 * el chequeador escanea cuando **llega el primero**, no cuando ha llegado todo. La 0080
 * apuntaba en ese momento lo surtido hasta entonces, y como `despachar` descuenta hasta lo
 * chequeado, el camión salía con el primer pallet y el resto se quedaba en el andén sin que
 * nadie lo dijera. Medido: una línea de 10 cajas partida en dos viajes de 5 salía con 5.
 *
 * Así que el escaneo vuelve a no escribir cantidad. Escanear sigue significando lo que él
 * dijo que significa —«está todo, y es la cantidad correcta»—, y eso en la base se dice
 * mejor sin número: sin corrección sale todo lo que bajó, sea en uno o en cuatro viajes.
 * La cantidad la escribe **sólo la corrección**, que es la única que es un dato nuevo.
 */
create or replace function verificar_linea(p_order_id uuid, p_codigo text)
returns table (linea smallint, sku text, nombre text, ya_estaba boolean, cajas numeric)
language plpgsql security definer set search_path = public as $f$
declare
  v_linea order_line;
  v_surtido numeric;
  v_repetida boolean := false;
begin
  if not has_role('auxiliar', 'chequeador', 'montacargista', 'supervisor', 'admin') then
    raise exception 'No tienes permiso para chequear el camión';
  end if;

  /**
   * De las líneas de este camión, la que lleva ese código y todavía no está marcada. Si todas
   * las que lo llevan ya están marcadas, se devuelve una para avisar de que se repitió.
   */
  select * into v_linea
  from order_line l
  where l.order_id = p_order_id
    and l.product_id in (select productos_por_codigo(p_codigo))
  order by (l.checked_at is not null), l.line_no
  limit 1;

  if not found then
    -- Distinguir el código que nadie conoce del que no va en este camión: son dos cosas.
    if not exists (select 1 from productos_por_codigo(p_codigo)) then
      raise exception 'No conozco el código %', trim(p_codigo);
    end if;
    raise exception 'Ese producto no va en este camión';
  end if;

  v_repetida := v_linea.checked_at is not null;
  v_surtido := surtido_de_linea(v_linea.id);

  if not v_repetida then
    if v_surtido <= 0 then
      raise exception 'De % no hay nada surtido todavía: no se puede chequear lo que no bajó',
        (select p.name from product p where p.id = v_linea.product_id);
    end if;

    update order_line
    set checked_at = now(), checked_by = auth.uid()
    where id = v_linea.id;
  end if;

  -- Lo que la pantalla enseña: lo corregido si lo hay, y si no, todo lo que ha bajado.
  return query
    select v_linea.line_no, p.sku, p.name, v_repetida,
           coalesce(v_linea.checked_qty_base, v_surtido)
    from product p where p.id = v_linea.product_id;
end;
$f$;

/**
 * Y lo que la 0080 dejó apuntado se borra: ninguna de esas cifras la escribió nadie contando,
 * las escribió el escaneo. Una corrección de verdad todavía no ha podido ocurrir —la pantalla
 * que la hace no se había desplegado—, así que aquí no se pierde ningún dato.
 */
update order_line l
set checked_qty_base = null
where l.checked_qty_base is not null
  and exists (
    select 1 from sales_order o where o.id = l.order_id and o.status <> 'SHIPPED'
  );
