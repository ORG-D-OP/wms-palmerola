import { bootDb, check } from './lib/boot-db.mjs'

const db = await bootDb()
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const fails = async (sql, params) =>
  db.query(sql, params).then(
    () => null,
    (e) => e.message,
  )

const { id: jefe } = await one(
  `insert into auth.users (email) values ('jefe@ejemplo.test') returning id`,
)
const { id: operario } = await one(
  `insert into auth.users (email) values ('surtidor@ejemplo.test') returning id`,
)
await db.query(`update profile set role = 'supervisor' where id = '${jefe}'`)
await db.query(`update profile set role = 'operador_picking' where id = '${operario}'`)
const como = (id) => db.query(`select set_config('request.jwt.claim.sub', '${id}', false)`)

const { id: productId } = await one(
  `insert into product (sku, name, base_uom, requires_fefo) values ('P-1', 'Galleta', 'ST', true)
   returning id`,
)
const { id: caseId } = await one(
  `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 24)
   returning id`,
  [productId],
)
await one(
  `insert into barcode (packaging_level_id, code, symbology, is_primary)
   values ($1, '17802225689141', 'GTIN14', true) returning id`,
  [caseId],
)

const [viejo, nuevo] = (
  await db.query(`select id, code from location where code in ('F1-001-01','F1-002-01') order by code`)
).rows

await como(jefe)
// Dos lotes: uno vence antes y debe salir primero.
await one(
  `select post_movement('RECEIPT'::movement_type, $1::uuid, 50::numeric, null, $2::uuid, null,
     'NUEVO'::text, '2027-12-31'::date)`,
  [productId, nuevo.id],
)
await one(
  `select post_movement('RECEIPT'::movement_type, $1::uuid, 30::numeric, null, $2::uuid, null,
     'VIEJO'::text, '2027-01-15'::date)`,
  [productId, viejo.id],
)

const { id: dock } = await one(`select id from dock_door where code = 'AND-S-03'`)
const { id: pedido } = await one(
  `insert into sales_order (code, customer, dock_door_id) values ('PED-001', 'Cliente', $1)
   returning id`,
  [dock],
)
await one(
  `insert into order_line (order_id, line_no, product_id, packaging_level_id, qty_base)
   values ($1, 1, $2, $3, 40) returning id`,
  [pedido, productId, caseId],
)

await como(operario)
const sinPermiso = await fails(`select release_order($1)`, [pedido])
check(sinPermiso?.includes('permiso'), 'un operario no puede liberar pedidos')

await como(jefe)
const tareas = await one(`select release_order($1) as n`, [pedido])
check(tareas.n === 2, 'reparte la linea entre dos existencias porque una sola no alcanza')

const orden = await db.query(
  `select l.code, a.qty_base, s.lot
   from allocation a join stock s on s.id = a.stock_id
   join location l on l.id = s.location_id
   join task t on t.id = a.task_id
   order by t.created_at`,
)
check(orden.rows[0]?.lot === 'VIEJO', 'aparta primero el lote que vence antes')
check(
  Number(orden.rows[0]?.qty_base) === 30 && Number(orden.rows[1]?.qty_base) === 10,
  'toma 30 del lote viejo y completa 10 del nuevo',
)

const reservado = await one(
  `select sum(qty_allocated)::numeric as q from stock where product_id = $1`,
  [productId],
)
check(Number(reservado.q) === 40, 'lo apartado deja de estar disponible para otra ola')

const { id: pedido2 } = await one(
  `insert into sales_order (code, dock_door_id) values ('PED-002', $1) returning id`,
  [dock],
)
await one(
  `insert into order_line (order_id, line_no, product_id, qty_base) values ($1, 1, $2, 50)
   returning id`,
  [pedido2, productId],
)
const sinStock = await fails(`select release_order($1)`, [pedido2])
check(
  sinStock?.includes('Falta existencia'),
  'un segundo pedido no puede contar con lo ya apartado',
)

await como(operario)
const tarea = await one(`select * from claim_next_task(array['PICK']::task_type[])`)
check(tarea.type === 'PICK', 'el surtidor recibe una tarea de surtido')

const otraPos = await fails(`select start_pick($1, 'F1-003-01')`, [tarea.id])
check(otraPos?.includes('no es la posición de esta tarea'), 'escanear otra posición se detiene')

await one(`select start_pick($1, $2)`, [tarea.id, viejo.code])

const otroProducto = await fails(`select * from complete_pick($1, '0000000000000', 30)`, [tarea.id])
check(otroProducto?.includes('no es el producto'), 'escanear otro producto se detiene')

const deMas = await fails(`select * from complete_pick($1, '17802225689141', 999)`, [tarea.id])
check(deMas?.includes('entre 1 y'), 'no se puede surtir mas de lo pedido')

const hecho = await one(`select * from complete_pick($1, '17802225689141', 30)`, [tarea.id])
check(Number(hecho.surtido) === 30, 'el surtido queda registrado')

const enAnden = await one(
  `select coalesce(sum(s.qty_base), 0) as q from stock s join location l on l.id = s.location_id
   where l.code = 'STG-AND-S-03'`,
)
check(Number(enAnden.q) === 30, 'las 30 cajas quedan en el andén de carga')

const origen = await one(
  `select coalesce(sum(qty_base), 0) as q from stock where location_id = $1`,
  [viejo.id],
)
check(Number(origen.q) === 0, 'la posición de origen queda vacía')

const estado = await one(`select status from sales_order where id = $1`, [pedido])
check(estado.status === 'PICKING', 'el pedido pasa a en surtido')

const tiempos = await one(`select * from task_timing where id = $1`, [tarea.id])
check(tiempos.ejecucion_min !== null, 'la tarea de surtido deja sus tiempos')
