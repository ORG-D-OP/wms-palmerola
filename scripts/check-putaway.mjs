import { bootDb, check } from './lib/boot-db.mjs'

const db = await bootDb()
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const fails = async (sql, params) =>
  db.query(sql, params).then(
    () => null,
    (e) => e.message,
  )

const { id: yo } = await one(`insert into auth.users (email) values ('yo@ejemplo.test') returning id`)
const { id: otro } = await one(`insert into auth.users (email) values ('otro@ejemplo.test') returning id`)
const como = (id) => db.query(`select set_config('request.jwt.claim.sub', '${id}', false)`)

// Los dos trabajan en la bodega: con el rango de solo lectura la cola no les da nada.
await db.query(
  `update profile set role = 'auxiliar' where id in ('${yo}', '${otro}')`,
)

const { id: productId } = await one(
  `insert into product (sku, name, base_uom) values ('T-1', 'Producto', 'ST') returning id`,
)
const { id: caseId } = await one(
  `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 24)
   returning id`,
  [productId],
)
const { id: anden } = await one(`select location_id as id from anden_de_recibo order by anden limit 1`)

await como(yo)
const r = await one(
  `select * from receive_pallet('PAL-9001', $1, $2, 144, $3, 'L2601', '2027-04-24', 'rec-1')`,
  [productId, caseId, anden],
)
await one(`select iniciar_turno()`)
const tarea = await one(`select * from claim_next_task(array['PUTAWAY']::task_type[])`)
check(tarea.id === r.task_id, 'el montacarguista recibe la tarea que dejo la recepcion')

const otroPallet = await fails(`select start_putaway($1, 'PAL-0000')`, [tarea.id])
check(
  otroPallet?.includes('no es el pallet de esta tarea'),
  'escanear otro pallet se detiene antes de mover nada',
)

await como(otro)
const ajena = await fails(`select start_putaway($1, $2)`, [tarea.id, r.lpn_code])
check(ajena?.includes('no es tuya'), 'no se puede ejecutar la tarea de otro')

await como(yo)
const sinEscanear = await fails(`select * from complete_putaway($1, $2)`, [
  tarea.id,
  r.to_location_code,
])
check(sinEscanear?.includes('Primero escanea el pallet'), 'no se cierra sin confirmar el pallet')

await one(`select start_putaway($1, $2)`, [tarea.id, r.lpn_code])

const inexistente = await fails(`select * from complete_putaway($1, 'NO-EXISTE')`, [tarea.id])
check(inexistente?.includes('No existe la posición'), 'una posicion inventada se rechaza')

// Un carril con otro producto no puede recibir este pallet.
const { id: intruso } = await one(
  `insert into product (sku, name, base_uom) values ('T-2', 'Otro', 'ST') returning id`,
)
const vecina = await one(
  `select l.code from location l
   where l.lane_id = (select lane_id from location where code = 'F1-002-01')
     and l.code <> 'F1-002-01' limit 1`,
)
await one(
  `select post_movement('RECEIPT'::movement_type, $1::uuid, 10::numeric, null,
     (select id from location where code = $2))`,
  [intruso, vecina.code],
)
const carrilOcupado = await fails(`select * from complete_putaway($1, 'F1-002-01')`, [tarea.id])
check(
  carrilOcupado?.includes('otro producto o lote'),
  'no deja guardar en un carril con otro producto',
)

const cerrada = await one(`select * from complete_putaway($1, $2)`, [tarea.id, r.to_location_code])
check(cerrada.era_la_sugerida === true, 'cerrar en la posicion sugerida queda marcado como tal')

const saldoAnden = await one(
  `select coalesce(sum(qty_base), 0) as q from stock where location_id = $1`,
  [anden],
)
const saldoDestino = await one(
  `select coalesce(sum(qty_base), 0) as q from stock s join location l on l.id = s.location_id
   where l.code = $1`,
  [r.to_location_code],
)
check(Number(saldoAnden.q) === 0, 'el anden queda libre')
check(Number(saldoDestino.q) === 3456, 'las 144 cajas quedan en su posicion, en unidades base')

const desglosado = await one(`select * from desglose($1, $2)`, [productId, saldoDestino.q])
check(
  desglosado.cajas === 144 && Number(desglosado.sueltas) === 0,
  'el pallet guardado se lee como 144 cajas completas',
)

const tareaFinal = await one(`select * from task where id = $1`, [tarea.id])
check(tareaFinal.status === 'DONE', 'la tarea queda cerrada')

const reserva = await one(
  `select reserved_by_task_id from location where code = $1`,
  [r.to_location_code],
)
check(reserva.reserved_by_task_id === null, 'la reserva del hueco se libera')

const tiempos = await one(`select * from task_timing where id = $1`, [tarea.id])
check(
  tiempos.viaje_min !== null && tiempos.ejecucion_min !== null,
  'el ciclo deja separados el viaje y la ejecucion',
)

const reCerrar = await fails(`select * from complete_putaway($1, $2)`, [
  tarea.id,
  r.to_location_code,
])
check(reCerrar?.includes('Primero escanea el pallet'), 'una tarea cerrada no se vuelve a cerrar')

// ---------------------------------------------------------------------------------------
// Lo apartado por otro cuenta igual que lo que ya esta en el carril (0069)
// ---------------------------------------------------------------------------------------
// La regla del carril es una sola: un producto y un lote. `complete_putaway` la hacia valer
// pero el sugeridor no la miraba, asi que mandaba a dos personas al mismo carril con
// productos distintos y la segunda rebotaba al llegar.

const { id: otroProducto } = await one(
  `insert into product (sku, name, base_uom) values ('T-99', 'Otro producto', 'ST') returning id`,
)
const { id: otroCase } = await one(
  `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 12)
   returning id`,
  [otroProducto],
)

const primero = await one(
  `select * from receive_pallet('PAL-9100', $1, $2, 10, $3, 'L-A', '2027-06-30', 'rec-100')`,
  [productId, caseId, anden],
)
const segundo = await one(
  `select * from receive_pallet('PAL-9101', $1, $2, 10, $3, 'L-B', '2027-06-30', 'rec-101')`,
  [otroProducto, otroCase, anden],
)

const carriles = await one(
  `select
     (select lane_id from location where code = $1) as uno,
     (select lane_id from location where code = $2) as dos`,
  [primero.to_location_code, segundo.to_location_code],
)
check(
  segundo.to_location_code !== null && carriles.uno !== carriles.dos,
  'a dos productos distintos recibidos a la vez no se les manda al mismo carril',
)

// Y la prueba de que eso era lo que rompia: el segundo puede guardar donde le dijeron.
// El primero toma la suya —la cola da la mas vieja— y el segundo la que queda.
await one(`select * from claim_next_task(array['PUTAWAY']::task_type[])`)

await como(otro)
await one(`select iniciar_turno()`)
const suya = await one(
  `select * from claim_next_task(array['PUTAWAY']::task_type[])`,
)
check(suya.lpn_id === segundo.lpn_id, 'cada quien se lleva su pallet de la cola')
await one(`select start_putaway($1, 'PAL-9101')`, [suya.id])
const guardada = await one(`select * from complete_putaway($1, $2)`, [
  suya.id,
  segundo.to_location_code,
])
check(
  guardada.era_la_sugerida === true,
  'y al llegar no le dicen que ese carril es de otro producto',
)
