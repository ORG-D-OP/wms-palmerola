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

const { id: productId } = await one(
  `insert into product (sku, name, base_uom) values ('T-1', 'Producto', 'ST') returning id`,
)
const { id: caseId } = await one(
  `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 24)
   returning id`,
  [productId],
)
const { id: anden } = await one(`select id from location where code = 'STG-AND-N-01'`)

await como(yo)
const r = await one(
  `select * from receive_pallet('PAL-9001', $1, $2, 144, $3, 'L2601', '2027-04-24', 'rec-1')`,
  [productId, caseId, anden],
)
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
check(inexistente?.includes('No existe la posicion'), 'una posicion inventada se rechaza')

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
check(Number(saldoDestino.q) === 144, 'las 144 cajas quedan en su posicion')

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
