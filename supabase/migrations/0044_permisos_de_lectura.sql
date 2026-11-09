/**
 * Tablas con política de lectura pero sin el permiso para leerlas.
 *
 * En Postgres hacen falta las dos cosas: el `grant`, que dice si el rol puede tocar la tabla,
 * y la política de RLS, que dice qué filas. La migración 0021 creó las políticas de una
 * docena de tablas y no los `grant`, así que `authenticated` se queda en la puerta: PostgREST
 * devuelve un error de permisos que las pantallas no muestran —leen `{ data }` y siguen— y el
 * resultado se ve como si no hubiera datos.
 *
 * Lo que estaba roto por esto, probándolo en la web:
 *  - **Disponibilidad** no podía leer `shift_assignment`, así que ofrecía «entrar a trabajo»
 *    a quien ya estaba trabajando, y no había forma de pausarse ni de salir. La contradicción
 *    se veía en la misma pantalla: el tablero sí sabía, porque pregunta por la vista.
 *  - **Áreas** no podía leer `area` ni `location_usage`: los dos desplegables salían vacíos y
 *    no había manera de declarar ni una posición de picking. Toda la pantalla, inservible.
 *  - La **flota** de montacargas no se podía listar ni dar de alta.
 *
 * Los `grant` no se saltan RLS: quién puede escribir lo sigue decidiendo la política, que para
 * estas tablas es supervisor o admin.
 */

grant select on
  area, area_type, location_area, location_usage, location_tag, tag,
  product_type, product_label_profile, inbound_doc, inbound_line,
  shift_assignment, equipment, equipment_type
to authenticated;

-- Lo único que las pantallas escriben sin pasar por una función: dar de alta un montacargas
-- y activarlo o desactivarlo.
grant insert, update on equipment to authenticated;
