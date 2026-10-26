import { bootDb, check } from './lib/boot-db.mjs'

const db = await bootDb()
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const fails = async (sql, params) =>
  db.query(sql, params).then(
    () => null,
    (e) => e.message,
  )

const { id: operario } = await one(
  `insert into auth.users (email) values ('operario@ejemplo.test') returning id`,
)
const { id: otro } = await one(
  `insert into auth.users (email) values ('otro@ejemplo.test') returning id`,
)
const comoOperario = (id) =>
  db.query(`select set_config('request.jwt.claim.sub', '${id}', false)`)

const { id: productId } = await one(
  `insert into product (sku, name, base_uom) values ('TEST-1', 'Producto', 'ST') returning id`,
)
const [alta, baja] = (
  await db.query(
    `select id from location where code in ('F1-001-01', 'F1-001-02') order by code`,
  )
).rows

await db.query(
  `insert into task (type, product_id, qty_base, to_location_id, priority)
   values ('PUTAWAY', $1, 10, $2, 500), ('PUTAWAY', $1, 10, $3, 100)`,
  [productId, alta.id, baja.id],
)

const sinSesion = await fails(`select claim_next_task()`)
check(sinSesion?.includes('sesion'), 'sin sesion no se puede tomar trabajo')

await comoOperario(operario)
const primera = await one(`select * from claim_next_task()`)
check(primera.priority === 500, 'la cola entrega primero la de mayor prioridad')
check(primera.assigned_to === operario, 'la tarea queda a nombre de quien la pidio')
check(primera.status === 'ASSIGNED', 'la tarea pasa a asignada')

await comoOperario(otro)
const segunda = await one(`select * from claim_next_task()`)
check(segunda.id !== primera.id, 'otra persona recibe una tarea distinta, nunca la misma')

const vacia = await one(`select * from claim_next_task()`)
check(vacia.id === null, 'sin trabajo pendiente la cola no devuelve nada')

const ajena = await fails(`select start_task($1)`, [primera.id])
check(ajena?.includes('no esta asignada a ti'), 'no se puede empezar la tarea de otro')

await comoOperario(operario)
await one(`select start_task($1)`, [primera.id])
await one(`select close_task($1, 'DONE')`, [primera.id])

const tiempos = await one(`select * from task_timing where id = $1`, [primera.id])
check(
  tiempos.espera_min !== null && tiempos.ejecucion_min !== null && tiempos.ciclo_min !== null,
  'la tarea cerrada deja sus tiempos para el KPI',
)

const recerrar = await fails(`select close_task($1, 'DONE')`, [primera.id])
check(recerrar?.includes('ya estaba cerrada'), 'una tarea cerrada no se cierra dos veces')

const malEstado = await fails(`select close_task($1, 'READY')`, [segunda.id])
check(malEstado?.includes('DONE, CANCELLED o BLOCKED'), 'no se cierra una tarea a un estado invalido')

// Reserva de hueco
await db.query(`update location set reserved_by_task_id = $1 where id = $2`, [segunda.id, alta.id])
const reservada = await one(
  `select reserved_by_task_id from location where id = $1`,
  [alta.id],
)
check(reservada.reserved_by_task_id === segunda.id, 'una posicion queda apartada por una tarea')

await comoOperario(otro)
await one(`select start_task($1)`, [segunda.id])
await one(`select close_task($1, 'CANCELLED', 'sin espacio')`, [segunda.id])
const liberada = await one(`select reserved_by_task_id from location where id = $1`, [alta.id])
check(liberada.reserved_by_task_id === null, 'al cerrar la tarea el hueco se libera solo')

// Reserva de existencia
const { id: lpnId } = await one(`insert into lpn (code) values ('LPN0000000099') returning id`)
await one(
  `select post_movement('RECEIPT'::movement_type, $1::uuid, 100::numeric, null, $2::uuid, $3::uuid)`,
  [productId, baja.id, lpnId],
)
await db.query(`update stock set qty_allocated = 40 where location_id = $1`, [baja.id])

const disponible = await one(
  `select qty_available from stock_available where location_id = $1`,
  [baja.id],
)
check(Number(disponible.qty_available) === 60, 'lo disponible descuenta lo ya reservado')

const sobreReserva = await fails(
  `update stock set qty_allocated = 150 where location_id = $1`,
  [baja.id],
)
check(sobreReserva !== null, 'no se puede reservar mas de lo que hay')
