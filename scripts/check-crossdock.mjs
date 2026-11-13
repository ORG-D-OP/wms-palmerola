import { bootDb, check } from './lib/boot-db.mjs'

/**
 * El producto que entra y sale el mismo dia. Lo que aqui se fija: que la opcion solo exista
 * cuando un camion abierto necesita ese producto, que el pallet no se parta en el anden, que
 * el crossdock cuente como surtido sin apartar existencia que nunca estuvo en el almacen, y
 * que al cerrar el camion el producto salga del anden en vez de quedarse ahi para siempre.
 */
const db = await bootDb()
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const todas = async (sql, params) => (await db.query(sql, params)).rows
const falla = async (sql, params) =>
  db.query(sql, params).then(
    () => null,
    (e) => e.message,
  )

const { id: jefe } = await one(
  `insert into auth.users (email) values ('sup@ejemplo.test') returning id`,
)
await db.query(`update profile set is_active = true, approved_at = now(), role = 'admin' where id = '${jefe}'`)
await db.query(`select set_config('request.jwt.claim.sub', '${jefe}', false)`)

const { id: producto } = await one(
  `insert into product (sku, name, base_uom) values ('X-1', 'Detergente', 'ST') returning id`,
)
const { id: caja } = await one(
  `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 24)
   returning id`,
  [producto],
)

const { id: andenIngreso, code: codigoIngreso } = await one(
  `select location_id as id, 'STG-' || anden as code from anden_de_recibo order by anden limit 1`,
)
const { id: andenSalida } = await one(`select id from dock_door where code = 'AND-03'`)
const { id: posicionSalida } = await one(`select id from location where code = 'STG-AND-03'`)

const { id: camion } = await one(
  `insert into sales_order (code, customer, dock_door_id, transporte)
   values ('PED-X1', 'Walmart', $1, '3916464') returning id`,
  [andenSalida],
)
await one(
  `insert into order_line (order_id, line_no, product_id, packaging_level_id, qty_base)
   values ($1, 1, $2, $3, 960) returning id`,
  [camion, producto, caja],
)

// --- a quien le falta esto ---------------------------------------------------------------

const falta = await todas(`select * from falta_para_despacho($1)`, [producto])
check(falta.length === 1 && falta[0].order_id === camion, 'el camión que necesita el producto aparece')
check(Number(falta[0].falta) === 960, 'con lo que le falta, en unidades')
check(falta[0].anden === 'AND-03', 'y el andén donde está cargando')

const { id: otroProducto } = await one(
  `insert into product (sku, name, base_uom) values ('X-2', 'Otro', 'ST') returning id`,
)
const sinFalta = await todas(`select * from falta_para_despacho($1)`, [otroProducto])
check(sinFalta.length === 0, 'un producto que nadie espera no ofrece crossdock')

// --- pasar el pallet al andén de despacho ------------------------------------------------

const recibido = await one(
  `select * from receive_pallet('PAL-X-001', $1, $2, 40, $3, 'L-1', '2027-05-31')`,
  [producto, caja, andenIngreso],
)
check(recibido.lpn_code === 'PAL-X-001', 'el pallet se recibe en el andén de ingreso')

const tareaGuardado = await one(
  `select status, to_location_id from task where lpn_id = (select id from lpn where code = 'PAL-X-001')
     and type = 'PUTAWAY'`,
)
check(tareaGuardado.status === 'READY', 'y queda su tarea de guardado, como cualquier ingreso')

const opciones = await todas(`select * from crossdock_posible('PAL-X-001')`)
check(opciones.length === 1 && opciones[0].order_id === camion, 'al operario se le ofrece ese camión')
check(Number(opciones[0].faltan_cajas) === 40, 'y se le dice cuántas cajas le faltan, en cajas')

const andenAjeno = await falla(`select * from crossdock('PAL-X-001', $1, 'AND-01')`, [camion])
check(
  andenAjeno?.includes('carga en el andén AND-03'),
  'si el andén escaneado no es el del camión, no pasa nada',
)

const paso = await one(`select * from crossdock('PAL-X-001', $1, 'STG-AND-03')`, [camion])
check(paso.anden === 'AND-03', 'el crossdock lo manda al andén del camión')
check(Number(paso.cajas) === 40, 'con las cajas que trae el pallet')
check(paso.etiqueta === '3916464', 'y dice a qué transporte se fue')

const cancelada = await one(
  `select status from task where lpn_id = (select id from lpn where code = 'PAL-X-001')
     and type = 'PUTAWAY'`,
)
check(cancelada.status === 'CANCELLED', 'el guardado se cancela: ese pallet ya no se guarda')

const hueco = await one(
  `select count(*)::int as n from location where reserved_by_task_id is not null`,
)
check(hueco.n === 0, 'y el hueco que tenía apartado se libera')

const enIngreso = await one(
  `select coalesce(sum(qty_base), 0) as q from stock where location_id = $1 and product_id = $2`,
  [andenIngreso, producto],
)
check(Number(enIngreso.q) === 0, `no queda saldo en ${codigoIngreso}`)

const enSalida = await one(
  `select coalesce(sum(qty_base), 0) as q from stock where location_id = $1 and product_id = $2`,
  [posicionSalida, producto],
)
check(Number(enSalida.q) === 960, 'y las 960 unidades están en el andén de carga')

const movimiento = await one(
  `select type, note from stock_movement where product_id = $1 and type = 'MOVE'`,
  [producto],
)
check(movimiento.note?.includes('Crossdock'), 'el libro mayor dice que fue un crossdock')

// --- cuenta como surtido, pero no aparta existencia --------------------------------------

const progreso = await one(`select * from despacho_progreso where id = $1`, [camion])
check(Number(progreso.surtido) === 960, 'el crossdock cuenta como surtido')
check(Number(progreso.crossdock) === 960, 'y se puede ver aparte, porque no salió del almacén')
check(progreso.pendientes === 0, 'sin tareas de surtido pendientes')

const apartado = await one(
  `select coalesce(sum(qty_allocated), 0) as q from stock where product_id = $1`,
  [producto],
)
check(Number(apartado.q) === 0, 'y no aparta existencia: nunca hubo nada apartado que apartar')

const yaNoFalta = await todas(`select * from falta_para_despacho($1)`, [producto])
check(yaNoFalta.length === 0, 'al camión ya no le falta nada de ese producto')

// --- lo que el crossdock no hace ---------------------------------------------------------

await one(`select * from receive_pallet('PAL-X-002', $1, $2, 40, $3, 'L-2', '2027-06-30')`, [
  producto,
  caja,
  andenIngreso,
])
const noNecesita = await falla(`select * from crossdock('PAL-X-002', $1)`, [camion])
check(
  noNecesita?.includes('no necesita'),
  'un segundo pallet no entra: al camión ya no le falta ese producto',
)

const { id: camionChico } = await one(
  `insert into sales_order (code, dock_door_id, transporte) values ('PED-X2', $1, '3916465')
   returning id`,
  [andenSalida],
)
await one(
  `insert into order_line (order_id, line_no, product_id, packaging_level_id, qty_base)
   values ($1, 1, $2, $3, 240)`,
  [camionChico, producto, caja],
)
const muyGrande = await falla(`select * from crossdock('PAL-X-002', $1)`, [camionChico])
check(
  muyGrande?.includes('guárdalo'),
  'si el camión necesita menos de lo que trae el pallet, se guarda y se surte normal',
)
check(muyGrande?.includes('10 cajas'), 'y el mensaje dice cuántas cajas le faltan, no unidades')

const { id: rack } = await one(`select id from location where code = 'F1-001-01'`)
await one(
  `select post_movement('PUTAWAY'::movement_type, $1::uuid, 960::numeric, $2::uuid, $3::uuid,
     (select id from lpn where code = 'PAL-X-002'), 'L-2', '2027-06-30'::date)`,
  [producto, andenIngreso, rack],
)
const yaGuardado = await falla(`select * from crossdock('PAL-X-002', $1)`, [camionChico])
check(
  yaGuardado?.includes('ya está guardado'),
  'un pallet que ya está en su posición no se cruza: se surte',
)

const inventado = await falla(`select * from crossdock('PAL-NO-EXISTE', $1)`, [camion])
check(inventado?.includes('ningún pallet'), 'una matrícula que no existe se rechaza')

// --- liberar no vuelve a apartar lo que el crossdock dejó puesto -------------------------

const tareas = await one(`select release_order($1) as n`, [camion])
check(tareas.n === 0, 'liberar el camión no genera surtido: ya está todo en el andén')

const estado = await one(`select status from sales_order where id = $1`, [camion])
check(estado.status === 'RELEASED', 'y el pedido queda liberado igual')

// --- al salir el camión, el producto sale del andén --------------------------------------

await one(`select despachar($1)`, [camion])
const salido = await one(`select status from sales_order where id = $1`, [camion])
check(salido.status === 'SHIPPED', 'el camión sale')

const despues = await one(
  `select coalesce(sum(qty_base), 0) as q from stock where location_id = $1 and product_id = $2`,
  [posicionSalida, producto],
)
check(Number(despues.q) === 0, 'y el andén queda vacío: el producto ya no está en la bodega')

const salida = await one(
  `select coalesce(sum(qty_base), 0) as q from stock_movement
   where product_id = $1 and type = 'SHIP'`,
  [producto],
)
check(Number(salida.q) === 960, 'el libro mayor registra la salida de las 960 unidades')
