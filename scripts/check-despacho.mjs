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
await db.query(`update profile set is_active = true, approved_at = now(), role = 'supervisor' where id = '${jefe}'`)
await db.query(`update profile set is_active = true, approved_at = now(), role = 'auxiliar' where id = '${operario}'`)
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
// La primera columna de F1 se declara area de picking, que es de donde salen las cajas y las
// unidades sueltas. Del almacen solo salen pallets completos, asi que una linea que no llena
// pallet tiene que encontrar producto aqui o queda como faltante.
await one(`select reasignar_area_por_codigo('F1-001-%', 'PICKING') as n`)
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
  sinLiberar?.includes('no se ha abierto'),
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


// --- la hoja es una lista de chequeo ----------------------------------------------------

await como(jefe)
await one(
  `insert into barcode (packaging_level_id, code, symbology, is_primary)
   values ($1, '17802225689141', 'GTIN14', true)`,
  [caja],
)

const { id: otro } = await one(
  `insert into product (sku, name, base_uom) values ('P-2', 'Jugo', 'ST') returning id`,
)
const { id: cajaOtro } = await one(
  `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 12)
   returning id`,
  [otro],
)
await one(
  `insert into barcode (packaging_level_id, code, symbology, is_primary)
   values ($1, '17802225689158', 'GTIN14', true)`,
  [cajaOtro],
)

const { id: anden2 } = await one(`select id from dock_door where code = 'AND-S-04'`)
const { id: segundo } = await one(
  `insert into sales_order (code, customer, dock_door_id, transporte)
   values ('PED-010', 'Pricesmart', $1, '3916470') returning id`,
  [anden2],
)
// Una linea con existencia y otra sin nada: el camion tiene que abrirse igual.
await one(
  `insert into order_line (order_id, line_no, product_id, packaging_level_id, qty_base)
   values ($1, 1, $2, $3, 24)`,
  [segundo, producto, caja],
)
await one(
  `insert into order_line (order_id, line_no, product_id, packaging_level_id, qty_base)
   values ($1, 2, $2, $3, 60)`,
  [segundo, otro, cajaOtro],
)

const abierto = await one(`select release_order($1) as n`, [segundo])
check(abierto.n >= 1, 'el camion se abre aunque una linea no tenga existencia')
const estado2 = await one(`select status from sales_order where id = $1`, [segundo])
check(estado2.status === 'RELEASED', 'y queda abierto, no en borrador')

const faltante = await one(
  `select l.qty_base - coalesce(sum(a.qty_base), 0) as falta
   from order_line l left join allocation a on a.order_line_id = l.id
   where l.order_id = $1 and l.line_no = 2 group by l.qty_base`,
  [segundo],
)
check(Number(faltante.falta) === 60, 'la linea sin existencia queda entera por apartar: eso es el rojo')

// --- chequear escaneando ----------------------------------------------------------------

await como(operario)
const marcada = await one(`select * from verificar_linea($1, '17802225689141')`, [segundo])
check(marcada.linea === 1, 'el auxiliar marca la linea escaneando la caja que sube')
check(marcada.ya_estaba === false, 'y la primera vez no estaba marcada')

const repetida = await one(`select * from verificar_linea($1, '17802225689141')`, [segundo])
check(repetida.ya_estaba === true, 'escanear dos veces lo mismo avisa, no rompe')

const sellada = await one(
  `select count(*)::int as n from order_line where order_id = $1 and checked_at is not null`,
  [segundo],
)
check(sellada.n === 1, 'y la marca queda en la linea, no en la pantalla')

const desconocido = await falla(`select verificar_linea($1, '99999999999999')`, [segundo])
check(desconocido?.includes('No conozco'), 'un codigo que no existe lo dice')

const { id: ajeno } = await one(
  `insert into product (sku, name, base_uom) values ('P-3', 'Aceite', 'ST') returning id`,
)
const { id: cajaAjena } = await one(
  `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 6)
   returning id`,
  [ajeno],
)
await one(
  `insert into barcode (packaging_level_id, code, symbology, is_primary)
   values ($1, '17802225689165', 'GTIN14', true)`,
  [cajaAjena],
)
const noVa = await falla(`select verificar_linea($1, '17802225689165')`, [segundo])
check(noVa?.includes('no va en este camión'), 'y un producto que no va en el camion, tambien')

// --- cerrar sin todo --------------------------------------------------------------------

await como(jefe)
const sinRazon = await falla(`select despachar($1, true, null)`, [segundo])
check(sinRazon?.includes('por qué'), 'cerrar un camion incompleto pide una razon')

await db.query(
  `update task set status = 'IN_PROGRESS', assigned_to = '${jefe}' where id in (
     select a.task_id from order_line l join allocation a on a.order_line_id = l.id
     where l.order_id = $1
   )`,
  [segundo],
)
const enCurso = await falla(`select despachar($1, true, 'el cliente lo recibe asi')`, [segundo])
check(
  enCurso?.includes('surtiendo'),
  'y no se cierra mientras alguien anda con un pallet de ese camion',
)

await db.query(
  `update task set status = 'READY', assigned_to = null where id in (
     select a.task_id from order_line l join allocation a on a.order_line_id = l.id
     where l.order_id = $1
   )`,
  [segundo],
)
const apartadoAntes = await one(
  `select sum(qty_allocated) as n from stock where product_id = $1`,
  [producto],
)
check(Number(apartadoAntes.n) > 0, 'antes de cerrar, lo del camion esta apartado')

await one(`select despachar($1, true, 'no habia producto y el cliente lo recibe asi')`, [segundo])
const cerrado = await one(`select status, ship_note from sales_order where id = $1`, [segundo])
check(cerrado.status === 'SHIPPED', 'el camion sale incompleto cuando se decide que salga')
check(cerrado.ship_note?.includes('no habia producto'), 'y la razon queda escrita en la hoja')

const apartadoDespues = await one(
  `select coalesce(sum(qty_allocated), 0) as n from stock where product_id = $1`,
  [producto],
)
check(
  Number(apartadoAntes.n) - Number(apartadoDespues.n) === 24,
  'lo que quedo sin surtir se suelta: no se queda apartado para un camion que ya se fue',
)

const canceladas = await one(
  `select count(*)::int as n from task where type = 'PICK' and status = 'CANCELLED'`,
)
check(canceladas.n > 0, 'y sus tareas quedan canceladas, no vivas para siempre')

// --- de donde sale el producto, y que pasa cuando no alcanza (0051) ----------------------

/**
 * La regla de la bodega: del area almacen solo salen pallets completos; las cajas y las
 * unidades salen de picking. Y si no alcanza, el camion se abre igual y marca lo que falta, porque la
 * persona que escaneo la hoja no se puede quedar mirando un error.
 */
const { id: churro } = await one(
  `insert into product (sku, name, base_uom) values ('P-4', 'Churro', 'ST') returning id`,
)
const { id: cajaChurro } = await one(
  `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 10)
   returning id`,
  [churro],
)

// Un pallet completo de 60 en el almacen, y nada en picking.
const { id: enRack } = await one(
  `select l.id from location l join lane la on la.id = l.lane_id
   join zone z on z.id = la.zone_id where z.kind = 'rack' limit 1`,
)
const { id: matricula } = await one(
  `insert into lpn (code, level, source) values ('PAL-TEST-1', 'PALLET', 'NEST') returning id`,
)
await one(
  `select post_movement('RECEIPT'::movement_type, $1::uuid, 60::numeric, null, $2::uuid, $3::uuid)`,
  [churro, enRack, matricula],
)

const areaDelPallet = await one(
  `select a.code from location_area la join area a on a.id = la.area_id
   where la.location_id = $1 and la.valid_to is null`,
  [enRack],
)
check(areaDelPallet.code === 'ALMACEN', 'el pallet de prueba esta en el area almacen')

// Se piden 75: caben 1 pallet completo (60) y sobran 15 que tendrian que salir de picking.
const { id: camionC } = await one(
  `insert into sales_order (code, dock_door_id, transporte) values ('PED-005', $1, '4000001')
   returning id`,
  [anden],
)
await one(
  `insert into order_line (order_id, line_no, product_id, packaging_level_id, qty_base)
   values ($1, 1, $2, $3, 75)`,
  [camionC, churro, cajaChurro],
)

const tareasC = await one(`select release_order($1) as n`, [camionC])
const estadoC = await one(`select status from sales_order where id = $1`, [camionC])
check(estadoC.status === 'RELEASED', 'sin producto suficiente el camion se abre igual')
check(tareasC.n === 1, 'y se arma solo la tarea del pallet completo')

const partido = await one(
  `select count(*)::int as n from stock st
   join location_area la on la.location_id = st.location_id and la.valid_to is null
   join area a on a.id = la.area_id
   where st.product_id = $1 and a.code = 'ALMACEN'
     and st.qty_allocated > 0 and st.qty_allocated < st.qty_base`,
  [churro],
)
check(partido.n === 0, 'y no se abre ningun pallet del almacen para completar')

const faltaC = await one(
  `select l.qty_base - coalesce(sum(a.qty_base), 0) as falta
   from order_line l left join allocation a on a.order_line_id = l.id
   where l.order_id = $1 group by l.id, l.qty_base`,
  [camionC],
)
check(Number(faltaC.falta) === 15, 'lo que no salio de picking queda como faltante: 15')

const lista = await db.query(`select * from faltante_de_despachos()`)
const esteFalta = lista.rows.find((f) => f.sku === 'P-4')
check(Number(esteFalta?.falta) === 15, 'y el faltante sale en la lista de lo que hay que reabastecer')

// Con producto en picking, lo que sobra si sale de ahi.
await one(`select reasignar_area_por_codigo('F1-002-%', 'PICKING') as n`)
const { id: enPicking } = await one(`select id from location where code = 'F1-002-01'`)
await one(
  `select post_movement('RECEIPT'::movement_type, $1::uuid, 40::numeric, null, $2::uuid)`,
  [churro, enPicking],
)

const { id: camionD } = await one(
  `insert into sales_order (code, dock_door_id, transporte) values ('PED-006', $1, '4000002')
   returning id`,
  [anden],
)
await one(
  `insert into order_line (order_id, line_no, product_id, packaging_level_id, qty_base)
   values ($1, 1, $2, $3, 15)`,
  [camionD, churro, cajaChurro],
)
await one(`select release_order($1) as n`, [camionD])

const deDonde = await one(
  `select a.code from allocation al
   join stock st on st.id = al.stock_id
   join location_area la on la.location_id = st.location_id and la.valid_to is null
   join area a on a.id = la.area_id
   join order_line l on l.id = al.order_line_id
   where l.order_id = $1`,
  [camionD],
)
check(deDonde.code === 'PICKING', 'con producto en picking, las cajas sueltas salen de ahi')

// --- el camion corto no se queda pegado (0052) --------------------------------------------

// El camion C sigue corto por 15, y su unica tarea —el pallet entero— ya se puede terminar.
await db.query(
  `update task set status = 'DONE', completed_at = now()
   where id in (
     select a.task_id from order_line l join allocation a on a.order_line_id = l.id
     where l.order_id = $1
   )`,
  [camionC],
)

const cortoAun = await one(`select status from sales_order where id = $1`, [camionC])
check(
  cortoAun.status !== 'PICKED',
  'con producto faltante el camion no se da por surtido, aunque sus tareas esten hechas',
)

const noSale = await falla(`select despachar($1)`, [camionC])
check(
  noSale?.includes('faltan'),
  'y no sale sin que alguien decida: un faltante pesa igual que una tarea a medias',
)

// En picking quedan 25 de las 40 que entraron: 15 se fueron en el camion D.
const recuperadas = await one(`select apartar_lo_que_falta() as n`)
check(Number(recuperadas.n) === 1, 'al reabastecer picking, lo que faltaba se aparta solo')

const yaCompleto = await one(`select falta_del_camion($1) as falta`, [camionC])
check(Number(yaCompleto.falta) === 0, 'y el camion queda completo, sin volver a abrirlo')

const noDuplica = await one(`select apartar_lo_que_falta($1) as n`, [camionC])
check(Number(noDuplica.n) === 0, 'pasar de nuevo sobre un camion completo no aparta de mas')

const yaSalio = await falla(`select apartar_lo_que_falta($1)`, [camion])
check(yaSalio?.includes('no está abierto'), 'y un camion que ya salio no se toca')

await db.query(
  `update task set status = 'DONE', completed_at = now()
   where status <> 'DONE' and id in (
     select a.task_id from order_line l join allocation a on a.order_line_id = l.id
     where l.order_id = $1
   )`,
  [camionC],
)
const surtidoC = await one(`select status from sales_order where id = $1`, [camionC])
check(surtidoC.status === 'PICKED', 'con la ultima caja surtida si queda surtido')

await one(`select despachar($1)`, [camionC])
const salioC = await one(`select status from sales_order where id = $1`, [camionC])
check(salioC.status === 'SHIPPED', 'y sale completo, sin nota de excepcion')

await db.close()
