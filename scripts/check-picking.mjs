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
await db.query(`update profile set is_active = true, approved_at = now(), role = 'supervisor' where id = '${jefe}'`)
await db.query(`update profile set is_active = true, approved_at = now(), role = 'auxiliar' where id = '${operario}'`)
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

// Las dos posiciones del pasillo F1 se declaran area de picking: lo que se guarda ahi son
// unidades sueltas sin pallet, y del area almacen solo salen pallets completos (0051).
await db.query(`select reasignar_area_por_codigo('F1-001-%', 'PICKING')`)
await db.query(`select reasignar_area_por_codigo('F1-002-%', 'PICKING')`)

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

// Abrir el despacho es escanear la hoja, y eso lo hace el que esta en el anden.
const { id: miron } = await one(
  `insert into auth.users (email) values ('consulta@ejemplo.test') returning id`,
)
await db.query(`update profile set is_active = true, approved_at = now(), role = 'solo_lectura' where id = '${miron}'`)

await como(miron)
const sinPermiso = await fails(`select release_order($1)`, [pedido])
check(sinPermiso?.includes('permiso'), 'el que solo consulta no puede abrir un despacho')

await como(operario)
const tareas = await one(`select release_order($1) as n`, [pedido])
check(tareas.n === 2, 'reparte la linea entre dos existencias porque una sola no alcanza')
check(true, 'y lo abre el auxiliar que tiene la hoja en la mano, no solo el jefe')

await como(jefe)

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
await one(`select release_order($1) as n`, [pedido2])

const corto = await one(
  `select o.status, coalesce(sum(a.qty_base), 0) as apartado
   from sales_order o
   join order_line l on l.order_id = o.id
   left join allocation a on a.order_line_id = l.id
   where o.id = $1 group by o.status`,
  [pedido2],
)
check(corto.status === 'RELEASED', 'el camion se abre igual: una linea corta no para las otras')
check(
  Number(corto.apartado) < 50,
  'pero no puede contar con lo ya apartado: la linea queda corta, que es lo que se ve en rojo',
)

await como(operario)
await one(`select iniciar_turno()`)
const tarea = await one(`select * from claim_next_task(array['PICK']::task_type[])`)
check(tarea.type === 'PICK', 'el surtidor recibe una tarea de surtido')

const otraPos = await fails(`select start_pick($1, 'F1-003-01')`, [tarea.id])
check(otraPos?.includes('no es la posición de esta tarea'), 'escanear otra posición se detiene')

await one(`select start_pick($1, $2)`, [tarea.id, viejo.code])

// Lo que pasa cuando a alguien se le recarga la pantalla con la posicion ya escaneada: la
// tarea empezada tiene que volver a el, no quedarse sin dueno con la existencia apartada.
const retomada = await one(`select * from claim_next_task(array['PICK']::task_type[])`)
check(retomada.id === tarea.id, 'al volver a la pantalla vuelve la tarea empezada, no otra')

const otraVez = await one(`select status from start_pick($1, $2)`, [tarea.id, viejo.code])
check(otraVez.status === 'IN_PROGRESS', 'y volver a escanear la posicion no es un error')

const reentra = await one(`select id from iniciar_turno()`)
check(reentra.id !== null, 'entrar a trabajo con algo empezado ya no se frena')

const sigueSuya = await one(`select * from claim_next_task(array['PICK']::task_type[])`)
check(sigueSuya.id === tarea.id, 'y al volver a entrar la tarea empezada sigue siendo suya')

const otroProducto = await fails(`select * from complete_pick($1, '0000000000000', 1, 6)`, [
  tarea.id,
])
check(otroProducto?.includes('no es el producto'), 'escanear otro producto se detiene')

const deMas = await fails(`select * from complete_pick($1, '17802225689141', 999)`, [tarea.id])
check(deMas?.includes('no puede pasarse'), 'no se puede surtir mas de lo pedido')

const negativas = await fails(`select * from complete_pick($1, '17802225689141', 1, -1)`, [
  tarea.id,
])
check(negativas?.includes('menos que cero'), 'las sueltas no pueden ser negativas')

// La tarea pide 30 unidades de un producto de 24 por caja: una caja y seis sueltas. Antes la
// pantalla pedia «cajas» y guardaba 30 unidades, que es un tercio de lo que decia.
const desconocido = await fails(`select * from complete_pick($1, 'NO-EXISTE', 1, 6)`, [tarea.id])
check(desconocido?.includes('no es el producto'), 'un codigo que nadie conoce se detiene')

const hecho = await one(`select * from complete_pick($1, 'P-1', 1, 6)`, [tarea.id])
check(Number(hecho.surtido) === 30, 'el surtido queda registrado en unidades')
check(hecho.texto === '1 caja y 6 sueltas', 'y el recibo lo dice en cajas y sueltas')

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

// Un pallet con matricula no puede quedar en dos lugares. Lo que sale sin vaciarlo
// deja de ser parte de el: va suelto, y el pallet se queda con el resto.
const [palletPos, anden] = (
  await db.query(`select id, code from location where code in ('F1-010-01','F1-011-01') order by code`)
).rows
const { id: matricula } = await one(
  `insert into lpn (code) values ('SN26TEST01') returning id`,
)
await one(
  `select post_movement(p_type => 'MOVE', p_product_id => $1, p_qty => 144,
     p_to_location_id => $2, p_lpn_id => $3, p_lot => 'PAL', p_expiry => '2027-06-30')`,
  [productId, palletPos.id, matricula],
)

const enDos = await fails(
  `select post_movement(p_type => 'MOVE', p_product_id => $1, p_qty => 10,
     p_from_location_id => $2, p_to_location_id => $3, p_lpn_id => $4,
     p_lot => 'PAL', p_expiry => '2027-06-30')`,
  [productId, palletPos.id, anden.id, matricula],
)
check(
  enDos?.includes('un_lugar_por_pallet'),
  'un pallet no puede tener existencia en dos posiciones',
)

await one(
  `select post_movement(p_type => 'MOVE', p_product_id => $1, p_qty => 10,
     p_from_location_id => $2, p_to_location_id => $3, p_lpn_id => $4,
     p_lot => 'PAL', p_expiry => '2027-06-30', p_desprende => true)`,
  [productId, palletPos.id, anden.id, matricula],
)

const queda = await one(
  `select qty_base, lpn_id from stock where location_id = $1 and qty_base > 0`,
  [palletPos.id],
)
check(
  Number(queda.qty_base) === 134 && queda.lpn_id === matricula,
  'el pallet se queda en su posicion con las 134 restantes',
)

const suelto = await one(
  `select qty_base, lpn_id from stock where location_id = $1 and qty_base > 0`,
  [anden.id],
)
check(
  Number(suelto.qty_base) === 10 && suelto.lpn_id === null,
  'las 10 que salieron quedan sueltas, sin matricula',
)
