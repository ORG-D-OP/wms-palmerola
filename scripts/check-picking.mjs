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

const { id: dock } = await one(`select id from dock_door where code = 'AND-03'`)
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

// Otro producto de verdad, con su barra, que es el caso que se midio a clic: dos que comparten
// la barra y se distinguen por el gramaje.
const { id: vecino } = await one(
  `insert into product (sku, name, base_uom) values ('P-VECINO', 'Galleta de otro gramaje', 'ST')
   returning id`,
)
const { id: cajaVecina } = await one(
  `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 30)
   returning id`,
  [vecino],
)
await one(
  `insert into barcode (packaging_level_id, code, symbology, is_primary)
   values ($1, '17802225689999', 'GTIN14', true) returning code`,
  [cajaVecina],
)

const otroProducto = await fails(`select * from complete_pick($1, '17802225689999', 1, 6)`, [
  tarea.id,
])
check(
  otroProducto?.includes('Escaneaste Galleta de otro gramaje') &&
    otroProducto?.includes('Esta tarea es de Galleta'),
  'escanear otro producto se detiene, y el mensaje nombra los dos: el leido y el de la tarea',
)

const deMas = await fails(`select * from complete_pick($1, '17802225689141', 999)`, [tarea.id])
check(deMas?.includes('no puede pasarse'), 'no se puede surtir mas de lo pedido')

const negativas = await fails(`select * from complete_pick($1, '17802225689141', 1, -1)`, [
  tarea.id,
])
check(negativas?.includes('menos que cero'), 'las sueltas no pueden ser negativas')

// La tarea pide 30 unidades de un producto de 24 por caja: una caja y seis sueltas. Antes la
// pantalla pedia «cajas» y guardaba 30 unidades, que es un tercio de lo que decia.
const desconocido = await fails(`select * from complete_pick($1, 'NO-EXISTE', 1, 6)`, [tarea.id])
check(
  desconocido?.includes('No conozco el código'),
  'un codigo que nadie conoce no se confunde con un producto equivocado: son dos cosas',
)

// Y lo mismo lo dice el escaneo, antes de que nadie teclee una cantidad: es la misma funcion.
const alEscanear = await fails(`select comprobar_codigo_de_tarea($1, '17802225689999')`, [
  tarea.id,
])
check(
  alEscanear?.includes('Escaneaste Galleta de otro gramaje'),
  'el codigo equivocado rebota en el escaneo, no tres pasos despues',
)
const bueno = await fails(`select comprobar_codigo_de_tarea($1, 'P-1')`, [tarea.id])
check(bueno === null, 'y el bueno pasa')

const hecho = await one(`select * from complete_pick($1, 'P-1', 1, 6)`, [tarea.id])
check(Number(hecho.surtido) === 30, 'el surtido queda registrado en unidades')
check(hecho.texto === '1 caja y 6 sueltas', 'y el recibo lo dice en cajas y sueltas')

const enAnden = await one(
  `select coalesce(sum(s.qty_base), 0) as q from stock s join location l on l.id = s.location_id
   where l.code = 'STG-AND-03'`,
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

// ---------------------------------------------------------------------------------------
// El aviso de reabastecimiento (0065)
// ---------------------------------------------------------------------------------------
// No hay olas: lanzar el reabastecimiento sigue siendo del jefe. Lo que el sistema hace es
// avisarle antes de que una posicion de picking se quede en nada.

await como(jefe)

// Un pallet del producto son 10 cajas de 24: 240 unidades es lo que cabe en una posicion.
await one(
  `insert into pallet_config (product_id, pallet_type_code, cases_per_pallet, is_default)
   values ($1, 'STD', 10, true)`,
  [productId],
)

const area = await one(`select replenish_pct from area where code = 'PICKING'`)
check(Number(area.replenish_pct) === 50, 'el aviso arranca en la mitad, que es lo que pidio')

// Una posicion de picking vacia con 100 unidades de 240 esta al 41%.
const hueco = await one(
  `select id, code from location where code = 'F1-001-02'`,
)
await one(
  `select post_movement(p_type => 'RECEIPT', p_product_id => $1, p_qty => 100,
     p_to_location_id => $2, p_lot => 'BAJO', p_expiry => '2027-09-30')`,
  [productId, hueco.id],
)

const avisa = await one(`select * from picking_bajo where posicion = $1`, [hueco.code])
check(avisa !== undefined, 'una posicion con menos de la mitad sale en el aviso')
check(Number(avisa.tope) === 240 && Number(avisa.pct) === 41, 'y dice cuanto cabe y cuanto le queda')

// Subirla por encima del liston la saca del aviso: 100 mas son 200 de 240, el 83%.
await one(
  `select post_movement(p_type => 'RECEIPT', p_product_id => $1, p_qty => 100,
     p_to_location_id => $2, p_lot => 'BAJO', p_expiry => '2027-09-30')`,
  [productId, hueco.id],
)
const llena = await one(`select count(*)::int as n from picking_bajo where posicion = $1`, [hueco.code])
check(llena.n === 0, 'y al llenarla se sale del aviso')

// Subir el liston la vuelve a meter: el porcentaje es un dato, no un numero escondido.
await one(`select ajustar_aviso_reabastecimiento('PICKING', 90::smallint)`)
const conOtroListon = await one(`select pct, replenish_pct from picking_bajo where posicion = $1`, [
  hueco.code,
])
check(
  conOtroListon !== undefined && Number(conOtroListon.replenish_pct) === 90,
  'y el jefe puede subir o bajar el liston',
)

const fuera = await fails(`select ajustar_aviso_reabastecimiento('PICKING', 0::smallint)`)
check(fuera?.includes('entre 1 y 100'), 'un aviso fuera de rango se rechaza')

await como(operario)
const ajeno = await fails(`select ajustar_aviso_reabastecimiento('PICKING', 70::smallint)`)
check(ajeno?.includes('Sólo el jefe'), 'y el liston no lo mueve cualquiera')

// ---------------------------------------------------------------------------------------
// Lo que el aviso contaba mal (0066)
// ---------------------------------------------------------------------------------------

await como(jefe)
await one(`select ajustar_aviso_reabastecimiento('PICKING', 50::smallint)`)

// Una posicion de picking lleva un saldo por lote y por matricula: el resto del lote viejo y
// el pallet que acaban de bajar son dos filas. Lo que importa es cuanto hay en la posicion.
const otra = await one(`select id, code from location where code = 'F1-001-07'`)
await one(
  `select post_movement(p_type => 'RECEIPT', p_product_id => $1, p_qty => 60,
     p_to_location_id => $2, p_lot => 'VIEJO', p_expiry => '2027-01-31')`,
  [productId, otra.id],
)
const soloViejo = await one(`select pct from picking_bajo where posicion = $1`, [otra.code])
check(Number(soloViejo?.pct) === 25, 'con un cuarto de lo que cabe la posicion sale en el aviso')

const { id: palletReab } = await one(
  `insert into lpn (code) values ('SN26REAB01') returning id`,
)
await one(
  `select post_movement(p_type => 'RECEIPT', p_product_id => $1, p_qty => 80,
     p_to_location_id => $2, p_lpn_id => $3, p_lot => 'NUEVO', p_expiry => '2027-03-31')`,
  [productId, otra.id, palletReab],
)
const sumada = await one(
  `select count(*)::int as n from picking_bajo where posicion = $1`,
  [otra.code],
)
check(sumada.n === 0, 'y el pallet que la reabastece la saca del aviso, aunque sea de otro lote')

// Al vaciarse del todo el saldo se queda en cero en vez de desaparecer, asi que la posicion
// salia del aviso justo en el peor momento.
await one(
  `select post_movement(p_type => 'MOVE', p_product_id => $1, p_qty => 200,
     p_from_location_id => $2, p_to_location_id => $3, p_lot => 'BAJO',
     p_expiry => '2027-09-30')`,
  [productId, hueco.id, anden.id],
)
const vacia = await one(
  `select pct, disponible from picking_bajo where posicion = $1`,
  [hueco.code],
)
check(
  Number(vacia?.pct) === 0 && Number(vacia?.disponible) === 0,
  'la posicion que se quedo en nada sigue en el aviso, en cero',
)

const lista = (await db.query(`select posicion, pct from picking_bajo`)).rows
check(
  lista.every((f, i) => i === 0 || Number(lista[i - 1].pct) <= Number(f.pct)) &&
    Number(lista[0].pct) === 0 &&
    lista.slice(0, 3).some((f) => f.posicion === hueco.code),
  'y la lista va de la que peor esta a la que mejor, con las vacias arriba',
)

// --- lo vencido no se aparta ni se recomienda (0077) --------------------------------------

/**
 * El reparto es FEFO, y la fecha mas vieja de todas es la del vencido: era lo primero que el
 * sistema mandaba a cargar. Medido en la base de verdad el 13/11: un camion con 3,480 unidades
 * apartadas de un producto que habia vencido el dia anterior.
 */
await como(jefe)

const dias = await one(`select dias_antes_de_vencer() as n`)
check(Number(dias.n) === 0, 'el tope arranca en cero: solo lo que ya vencio deja de salir')

const ayer = await one(`select vence_demasiado_pronto(hoy_de_bodega() - 1) as si`)
const hoy = await one(`select vence_demasiado_pronto(hoy_de_bodega()) as si`)
const sinFecha = await one(`select vence_demasiado_pronto(null) as si`)
check(ayer.si === true, 'lo que vencio ayer no puede salir')
check(hoy.si === false, 'lo que vence hoy todavia sale: el dia exacto, sin recortar')
check(sinFecha.si === false, 'y sin fecha no se puede decir que este vencido, asi que pasa')

// El tope es del sitio, no una constante: con siete dias, lo que vence en tres tampoco sale.
await db.query(`update site set expiry_block_days = 7`)
const enTres = await one(`select vence_demasiado_pronto(hoy_de_bodega() + 3) as si`)
const enDiez = await one(`select vence_demasiado_pronto(hoy_de_bodega() + 10) as si`)
check(
  enTres.si === true && enDiez.si === false,
  'y subiendo el tope del sitio deja de salir lo que vence antes de ese plazo',
)
await db.query(`update site set expiry_block_days = 0`)

// Medio pallet vencido en la misma posicion de picking que el lote bueno.
await one(
  `select post_movement(p_type => 'RECEIPT', p_product_id => $1, p_qty => 500,
     p_to_location_id => $2, p_lot => 'VENCIDO', p_expiry => hoy_de_bodega() - 1)`,
  [productId, hueco.id],
)

const noCuenta = await one(`select disponible from picking_bajo where posicion = $1`, [hueco.code])
check(
  noCuenta !== undefined && Number(noCuenta.disponible) === 0,
  'lo vencido en picking no cuenta como disponible: la posicion sigue pidiendo producto',
)

// Y un pallet vencido en el almacen no es de donde sacarlo.
const { id: palletVencido } = await one(
  `insert into lpn (code) values ('SN26VENC01') returning id`,
)
const enAlmacen = await one(
  `select l.id, l.code from location l
   join location_area la on la.location_id = l.id and la.valid_to is null
   join area a on a.id = la.area_id and a.type_code = 'ALMACEN'
   where l.retired_at is null and not exists (
     select 1 from stock s where s.location_id = l.id and s.qty_base > 0
   )
   limit 1`,
)
await one(
  `select post_movement(p_type => 'RECEIPT', p_product_id => $1, p_qty => 240,
     p_to_location_id => $2, p_lpn_id => $3, p_lot => 'VENCIDO',
     p_expiry => hoy_de_bodega() - 1)`,
  [productId, enAlmacen.id, palletVencido],
)

const deDonde = await one(`select sacar_de, vence_origen from picking_bajo where posicion = $1`, [
  hueco.code,
])
check(
  deDonde?.sacar_de !== enAlmacen.code,
  'y el aviso no manda a bajar un pallet vencido a picking',
)

// Y el reparto no lo toca, ni teniendo la fecha mas vieja de la bodega.
const { id: pedidoVencido } = await one(
  `insert into sales_order (code, dock_door_id) values ('PED-VENCE', $1) returning id`,
  [dock],
)
const { id: lineaVencida } = await one(
  `insert into order_line (order_id, line_no, product_id, packaging_level_id, qty_base)
   values ($1, 1, $2, (select id from packaging_level where product_id = $2 and code = 'CASE'), 700)
   returning id`,
  [pedidoVencido, productId],
)
await one(`select apartar_linea($1) as n`, [lineaVencida])

const apartado = await db.query(
  `select st.lot, st.expiry_date, a.qty_base from allocation a
   join stock st on st.id = a.stock_id where a.order_line_id = $1`,
  [lineaVencida],
)
check(
  apartado.rows.length > 0 && apartado.rows.every((f) => f.lot !== 'VENCIDO'),
  'el reparto salta lo vencido, aunque sea lo primero que pide el FEFO',
)

// --- la posicion no esta huecoVacio: la tiene otro (0081) --------------------------------------

/**
 * Un renglon en cero es lo que dice «esta posicion es de este producto», y por eso una
 * posicion que se vacio sigue saliendo en el aviso. Pero si mientras tanto alguien dejo otro
 * producto ahi, el aviso mandaba un viaje que el propio escaneo del destino rechaza: decia
 * «esta huecoVacio, y caben 240 cajas» de una posicion con producto encima.
 */
const { id: jabonEstorbo } = await one(
  `insert into product (sku, name, base_uom) values ('P-OCUPA', 'Jabon que estorba', 'ST')
   returning id`,
)
await one(
  `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 12)`,
  [jabonEstorbo],
)
const { id: huecoAjeno } = await one(`select id from location where code = 'F1-001-04'`)

// El renglon en cero del producto de picking: la posicion es suya y esta huecoVacio.
await one(
  `select post_movement(p_type => 'RECEIPT', p_product_id => $1, p_qty => 50,
     p_to_location_id => $2, p_lot => 'SEVA', p_expiry => '2027-09-30')`,
  [productId, huecoAjeno],
)
await one(
  `select post_movement(p_type => 'MOVE', p_product_id => $1, p_qty => 50,
     p_from_location_id => $2, p_to_location_id => (select id from location where code = 'F1-015-06'),
     p_lot => 'SEVA', p_expiry => '2027-09-30')`,
  [productId, huecoAjeno],
)

const huecoVacio = await one(
  `select disponible, ocupada_por from picking_bajo where posicion = 'F1-001-04' and sku <> 'P-OCUPA'`,
)
check(
  huecoVacio !== undefined && Number(huecoVacio.disponible) === 0 && huecoVacio.ocupada_por === null,
  'una posicion de picking vacia sale en el aviso y no tiene a nadie ocupandola',
)

// Y ahora alguien deja otro producto ahi.
await one(
  `select post_movement(p_type => 'RECEIPT', p_product_id => $1, p_qty => 36,
     p_to_location_id => $2)`,
  [jabonEstorbo, huecoAjeno],
)
const huecoOcupado = await one(
  `select disponible, ocupada_por from picking_bajo where posicion = 'F1-001-04' and sku <> 'P-OCUPA'`,
)
check(
  huecoOcupado !== undefined && Number(huecoOcupado.disponible) === 0,
  'la posicion sigue saliendo: el picking de ese producto de verdad esta en cero',
)
check(
  huecoOcupado?.ocupada_por === 'Jabon que estorba',
  `pero el aviso nombra al que la tiene en vez de prometer un hueco (${huecoOcupado?.ocupada_por})`,
)
