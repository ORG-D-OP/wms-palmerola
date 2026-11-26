/**
 * Las unidades partidas que ya estaban escritas.
 *
 * La 0112 cerró la puerta por donde entran: la conversión de cajas de SAP a unidades base
 * redondea, y las pantallas redondean al salir. Pero lo que ya estaba escrito seguía partido,
 * y no es sólo un número feo. Un ejemplo medido en el camión 3946128: una línea pide una caja
 * de 24 y la bodega sólo le apartó **20.008**. El auxiliar no puede confirmar esa tarea: la
 * pantalla le enseña 20 —redondeado— y `complete_pick` le contesta que la tarea pide 20.008 y
 * que no puede pasarse de ahí. La tarea se queda viva, el camión sale corto por ocho milésimas
 * de bolsa, y la precisión del día lo apunta como camión incompleto.
 *
 * Así que se redondea lo que queda. Son centésimas de unidad en 250 renglones de existencia,
 * 31 líneas de pedido, 3 apartados y 3 tareas, todas nacidas de la carga inicial y de los
 * archivos de antes de la 0112.
 *
 * Lo que **no** se toca, a propósito: el libro mayor. `stock_movement` es lo que pasó, y lo
 * que pasó llevaba decimales. Reescribir la historia para que cuadre con el saldo sería
 * mentir sobre lo que se recibió; la diferencia es menor que una unidad por renglón y el
 * primer conteo cíclico la deja en su sitio con su razón escrita.
 *
 * Y las tareas ya terminadas tampoco: lo que se surtió, se surtió.
 */

-- Primero lo reservado, que no puede pasarse de la existencia: si se redondean los dos a la
-- vez, el momento intermedio rompe `reservado_no_supera_existencia`.
update stock
set qty_allocated = least(round(qty_allocated), round(qty_base)),
    qty_base = round(qty_base)
where qty_base <> round(qty_base) or qty_allocated <> round(qty_allocated);

-- Nunca a cero: una línea de pedido o un apartado en cero no existen —lo dicen sus propias
-- restricciones— y lo que se pidió, aunque sea una fracción de unidad, es al menos una.
update order_line
set qty_base = greatest(round(qty_base), 1)
where qty_base <> round(qty_base);

update allocation
set qty_base = greatest(round(qty_base), 1)
where qty_base <> round(qty_base);

update task
set qty_base = greatest(round(qty_base), 1)
where qty_base <> round(qty_base)
  and status not in ('DONE', 'CANCELLED');

-- No se le pone una restricción a `stock` que lo exija. Es tentador, pero una restricción que
-- salta deja la pantalla en «Algo se cayó» en medio de un turno, y la puerta por donde entraban
-- las fracciones ya está cerrada en la 0112. Si vuelven a aparecer, el conteo cíclico las verá.
