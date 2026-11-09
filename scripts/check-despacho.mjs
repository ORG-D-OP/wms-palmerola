import { bootDb, check } from './lib/boot-db.mjs'

/**
 * El despacho se abre escaneando el transporte, y un transporte es un solo camion aunque
 * venga impreso en tres hojas. Lo que aqui se fija: que el transporte no se repita, que el
 * escaneo encuentre, que el pedido se cierre solo cuando ya no queda tarea viva, y que
 * nadie saque un camion con surtido a medias.
 */
const db = await bootDb()
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const falla = async (sql, params) =>
  db.query(sql, params).then(
    () => null,
    (e) => e.message,
  )

const { id: jefe } = await one(
  `insert into auth.users (email) values ('jefe@ejemplo.test') returning id`,
)
const { id: operario } = await one(
  `insert into auth.users (email) values ('aux@ejemplo.test') returning id`,
)
await db.query(`update profile set role = 'supervisor' where id = '${jefe}'`)
await db.query(`update profile set role = 'auxiliar' where id = '${operario}'`)
const como = (id) => db.query(`select set_config('request.jwt.claim.sub', '${id}', false)`)

await como(jefe)

const { id: producto } = await one(
  `insert into product (sku, name, base_uom) values ('P-1', 'Galleta', 'ST') returning id`,
)
const { id: caja } = await one(
  `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 24)
   returning id`,
  [producto],
)
const { id: posicion } = await one(`select id from location where code = 'F1-001-01'`)
await one(
  `select post_movement('RECEIPT'::movement_type, $1::uuid, 100::numeric, null, $2::uuid)`,
  [producto, posicion],
)

const { id: anden } = await one(`select id from dock_door where code = 'AND-S-03'`)
const { id: camion } = await one(
  `insert into sales_order (code, customer, dock_door_id, transporte, entregas)
   values ('PED-001', 'Walmart', $1, '3916464', array['0314014533','0314015681']) returning id`,
  [anden],
)
await one(
  `insert into order_line (order_id, line_no, product_id, packaging_level_id, qty_base)
   values ($1, 1, $2, $3, 40)`,
  [camion, producto, caja],
)

// --- el transporte identifica, y es uno solo -------------------------------------------

const repetido = await falla(
  `insert into sales_order (code, dock_door_id, transporte) values ('PED-002', $1, '3916464')`,
  [anden],
)
check(repetido !== null, 'dos pedidos no pueden tener el mismo transporte')

await one(
  `insert into sales_order (code, dock_door_id, transporte) values ('PED-003', $1, null)`,
  [anden],
)
await one(
  `insert into sales_order (code, dock_door_id, transporte) values ('PED-004', $1, null)`,
  [anden],
)
check(true, 'pero varios pedidos pueden no tener transporte todavia')

const porTransporte = await one(`select buscar_despacho('3916464') as id`)
check(porTransporte.id === camion, 'el escaneo del transporte encuentra el camion')

const conEspacios = await one(`select buscar_despacho('  3916464 ') as id`)
check(conEspacios.id === camion, 'y aguanta los espacios que mete el lector')

const porCodigo = await one(`select buscar_despacho('PED-003') as id`)
check(porCodigo.id !== null, 'tecleando el codigo del pedido tambien encuentra')

const inventado = await one(`select buscar_despacho('9999999') as id`)
check(inventado.id === null, 'un codigo que no existe no devuelve nada')

// --- lo que ve el chequeador ------------------------------------------------------------

const antes = await one(`select * from despacho_progreso where id = $1`, [camion])
check(antes.lineas === 1 && Number(antes.pedido) === 40, 'el resumen cuenta la linea y lo pedido')
check(Number(antes.surtido) === 0, 'y arranca sin nada surtido')
check(antes.transporte === '3916464', 'el resumen trae el transporte')
check(antes.entregas.length === 2, 'y los documentos de la hoja, para cruzar contra el papel')

// --- no se saca un camion a medias ------------------------------------------------------

const sinLiberar = await falla(`select despachar($1)`, [camion])
check(
  sinLiberar?.includes('no se ha liberado'),
  'un borrador no sale: sin tareas, la cuenta de pendientes da cero y pasaria de largo',
)

await one(`select release_order($1)`, [camion])
const conTareas = await one(`select * from despacho_progreso where id = $1`, [camion])
check(conTareas.pendientes > 0, 'al liberar quedan tareas de surtido abiertas')

const aMedias = await falla(`select despachar($1)`, [camion])
check(aMedias?.includes('Faltan'), 'con tareas abiertas el camion no sale')

// --- cerrar -----------------------------------------------------------------------------

await db.query(
  `update task set status = 'DONE', completed_at = now()
   where type = 'PICK' and id in (
     select a.task_id from order_line l join allocation a on a.order_line_id = l.id
     where l.order_id = $1
   )`,
  [camion],
)

const surtido = await one(`select status from sales_order where id = $1`, [camion])
check(surtido.status === 'PICKED', 'cuando la ultima tarea termina, el pedido queda surtido')

await como(operario)
const sinPermiso = await falla(`select despachar($1)`, [camion])
check(sinPermiso?.includes('permiso'), 'un auxiliar no despacha camiones')

await como(jefe)
await one(`select despachar($1)`, [camion])
const salido = await one(`select status, shipped_at from sales_order where id = $1`, [camion])
check(salido.status === 'SHIPPED', 'el jefe cierra el camion')
check(salido.shipped_at !== null, 'y queda la hora de salida')

const dosVeces = await falla(`select despachar($1)`, [camion])
check(dosVeces?.includes('ya salió'), 'un camion no sale dos veces')
