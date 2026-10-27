import { bootDb, check } from './lib/boot-db.mjs'

const db = await bootDb()
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const fails = async (sql, params) =>
  db.query(sql, params).then(
    () => null,
    (e) => e.message,
  )

const { id: userId } = await one(
  `insert into auth.users (email) values ('recibo@ejemplo.test') returning id`,
)
await db.query(`select set_config('request.jwt.claim.sub', '${userId}', false)`)

const { id: productId } = await one(
  `insert into product (sku, name, base_uom, requires_fefo, status)
   values ('98914.4', 'Galleta surtida', 'ST', true, 'active') returning id`,
)
const { id: caseId } = await one(
  `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 24)
   returning id`,
  [productId],
)
const { id: bloqueadoId } = await one(
  `insert into product (sku, name, base_uom, status)
   values ('BLOQ-1', 'Producto bloqueado', 'ST', 'blocked') returning id`,
)
const { id: anden } = await one(`select id from location where code = 'STG-AND-N-01'`)

const sinVencimiento = await fails(
  `select * from receive_pallet('PAL-0001', $1, $2, 144, $3)`,
  [productId, caseId, anden],
)
check(
  sinVencimiento?.includes('fecha de vencimiento'),
  'un producto con FEFO no se recibe sin fecha de vencimiento',
)

const bloqueado = await fails(
  `select * from receive_pallet('PAL-0002', $1, null, 10, $2, null, '2027-04-24')`,
  [bloqueadoId, anden],
)
check(bloqueado?.includes('blocked'), 'un producto bloqueado no se puede recibir')

const r = await one(
  `select * from receive_pallet('PAL-0003', $1, $2, 144, $3, 'L2601', '2027-04-24', 'rec-1')`,
  [productId, caseId, anden],
)
check(r.lpn_code === 'PAL-0003', 'la matricula es la que traia la etiqueta')
check(r.to_location_id !== null, `asigna una posicion de destino (${r.to_location_code})`)

const enAnden = await one(
  `select qty_base from stock where location_id = $1 and qty_base > 0`,
  [anden],
)
check(Number(enAnden.qty_base) === 144, 'la existencia queda en la posicion de anden')

const tarea = await one(`select * from task where id = $1`, [r.task_id])
check(tarea.type === 'PUTAWAY' && tarea.status === 'READY', 'deja la tarea de guardado lista')
check(tarea.from_location_id === anden, 'la tarea parte del anden')

const reserva = await one(
  `select reserved_by_task_id, reserved_until from location where id = $1`,
  [r.to_location_id],
)
check(reserva.reserved_by_task_id === r.task_id, 'el destino queda apartado para esa tarea')
check(reserva.reserved_until !== null, 'la reserva tiene vencimiento')

const segundo = await one(
  `select * from receive_pallet('PAL-0004', $1, $2, 144, $3, 'L2601', '2027-04-24', 'rec-2')`,
  [productId, caseId, anden],
)
check(
  segundo.to_location_id !== r.to_location_id,
  'el segundo pallet no recibe la posicion ya apartada',
)

const { id: otroProducto } = await one(
  `insert into product (sku, name, base_uom) values ('OTRO-1', 'Otro producto', 'ST')
   returning id`,
)
await db.query(
  `select post_movement('PUTAWAY'::movement_type, $1::uuid, 144::numeric, $2::uuid, $3::uuid,
                        $4::uuid, 'L2601'::text, '2027-04-24'::date)`,
  [productId, anden, r.to_location_id, r.lpn_id],
)

const destinoOtro = await one(`select suggest_putaway_location($1) as id`, [otroProducto])
const mismoCarril = await one(
  `select count(*)::int as n
   from location a join location b on a.lane_id = b.lane_id
   where a.id = $1 and b.id = $2`,
  [r.to_location_id, destinoOtro.id],
)
check(mismoCarril.n === 0, 'otro producto no se sugiere en un carril ya ocupado')

const repetida = await fails(
  `select * from receive_pallet('PAL-0003', $1, $2, 10, $3, 'L2601', '2027-04-24')`,
  [productId, caseId, anden],
)
check(
  repetida?.includes('ya esta en el sistema'),
  'una matricula repetida se rechaza y dice donde esta ese pallet',
)

const sinEtiqueta = await fails(
  `select * from receive_pallet('  ', $1, $2, 10, $3, 'L2601', '2027-04-24')`,
  [productId, caseId, anden],
)
check(sinEtiqueta?.includes('Escanea la etiqueta'), 'no se recibe sin escanear la etiqueta')
