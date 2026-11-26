/**
 * Un escaneo marca el producto, no una línea de las veintiuna.
 *
 * El ZRDT trae una línea por posición de entrega, así que un camión con veintiuna paradas que
 * llevan el mismo aceite trae veintiuna líneas idénticas: mismo material, misma caja, mismo
 * todo. En el andén eso no existe. Lo que sube es aceite, y el chequeador no tiene forma de
 * saber —ni le importa— a qué parada va cada caja: la separación en entregas es del cliente y
 * la hace el que reparte, no el que carga.
 *
 * `verificar_linea` marcaba **una** de esas líneas por escaneo, la de menor número sin marcar.
 * El camión 3946128 tiene 259 líneas y 107 productos: el chequeador escaneaba el mismo código
 * veintiuna veces seguidas viendo cómo se encendía una palomita distinta cada vez. Es la misma
 * queja que arregló la 0114 del otro lado del andén, donde el auxiliar hacía veintiún viajes
 * por el mismo pallet.
 *
 * Ahora un escaneo marca todas las líneas de ese producto que hayan bajado algo al andén. Las
 * que no bajaron nada se quedan sin marcar, como siempre: ésas son las del camión corto, y se
 * cierran con su razón escrita.
 *
 * Lo demás queda igual: el guardia es el chequeador, repetir el escaneo sigue avisando de que
 * ya estaba, y la cantidad que devuelve —que es la que la pantalla canta— ahora es la suma de
 * lo que subió de ese producto, no la de una línea suelta.
 */
create or replace function verificar_linea(p_order_id uuid, p_codigo text)
returns table (linea smallint, sku text, nombre text, ya_estaba boolean, cajas numeric)
language plpgsql security definer set search_path = public as $f$
declare
  v_producto uuid;
  v_primera smallint;
  v_marcadas integer := 0;
  v_con_producto integer := 0;
  v_repetida boolean;
  fila record;
begin
  if not has_role('chequeador', 'supervisor', 'admin') then
    raise exception 'El camión lo chequea el chequeador del andén, con la hoja en la mano';
  end if;

  select l.product_id into v_producto
  from order_line l
  where l.order_id = p_order_id
    and l.product_id in (select productos_por_codigo(p_codigo))
  limit 1;

  if v_producto is null then
    -- Distinguir el código que nadie conoce del que no va en este camión: son dos cosas.
    if not exists (select 1 from productos_por_codigo(p_codigo)) then
      raise exception 'No conozco el código %', trim(p_codigo);
    end if;
    raise exception 'Ese producto no va en este camión';
  end if;

  for fila in
    select ol.id, ol.line_no, ol.checked_at, surtido_de_linea(ol.id) as surtido
    from order_line ol
    where ol.order_id = p_order_id and ol.product_id = v_producto
    order by ol.line_no
  loop
    if fila.checked_at is null and fila.surtido > 0 then
      update order_line set checked_at = now(), checked_by = auth.uid() where id = fila.id;
      v_marcadas := v_marcadas + 1;
      if v_primera is null then v_primera := fila.line_no; end if;
    end if;
    if fila.surtido > 0 or fila.checked_at is not null then
      v_con_producto := v_con_producto + 1;
      if v_primera is null then v_primera := fila.line_no; end if;
    end if;
  end loop;

  -- Nada que marcar y nada marcado antes: de ese producto no ha bajado una caja al andén.
  if v_con_producto = 0 then
    raise exception 'De % no hay nada surtido todavía: no se puede chequear lo que no bajó',
      (select p.name from product p where p.id = v_producto);
  end if;

  v_repetida := v_marcadas = 0;

  -- Lo que la pantalla canta: todo lo que subió de ese producto, corregido donde se corrigió.
  return query
    select v_primera, p.sku, p.name, v_repetida,
           coalesce(
             (select sum(coalesce(ol.checked_qty_base, surtido_de_linea(ol.id)))
              from order_line ol
              where ol.order_id = p_order_id
                and ol.product_id = v_producto
                and ol.checked_at is not null),
             0
           )
    from product p where p.id = v_producto;
end;
$f$;

grant execute on function verificar_linea to authenticated;
