/**
 * El chequeador trae la hoja con el número de entrega, y el camión no se abría.
 *
 * `buscar_despacho` sólo admitía el transporte o el código del pedido, exactos. Su hermana de
 * ingreso, `ingreso_por_codigo`, lleva desde la 0103 encontrando el documento por cualquiera
 * de los números que vienen impresos y quitando los ceros de la izquierda —SAP los pone y el
 * lector no siempre—, así que lo mismo de este lado: el transporte, el código del pedido o
 * **cualquiera de las entregas** del camión, que ya están guardadas en `sales_order.entregas`
 * y hasta hoy no las miraba nadie.
 *
 * El orden importa cuando varios cuadran: primero el transporte, que es el código de barras
 * de la hoja; después el pedido; y por último la entrega, que es de una parada del camión y
 * no del camión entero.
 */
create or replace function buscar_despacho(p_codigo text) returns uuid
language sql stable security definer set search_path = public as $f$
  with buscado as (select ltrim(trim(p_codigo), '0') as c)
  select o.id
  from sales_order o, buscado
  where buscado.c <> '' and (
    ltrim(coalesce(o.transporte, ''), '0') = buscado.c
    or ltrim(o.code, '0') = buscado.c
    or exists (
      select 1 from unnest(coalesce(o.entregas, array[]::text[])) as e
      where ltrim(e, '0') = buscado.c
    )
  )
  order by
    (ltrim(coalesce(o.transporte, ''), '0') = buscado.c) desc,
    (ltrim(o.code, '0') = buscado.c) desc,
    o.created_at
  limit 1;
$f$;

grant execute on function buscar_despacho(text) to authenticated;
