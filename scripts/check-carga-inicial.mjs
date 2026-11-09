import { bootDb, check } from './lib/boot-db.mjs'

/**
 * El dia uno: bodega llena de producto y un sistema que no sabe nada. Lo que aqui se fija:
 * que el producto quede directo en su posicion sin pasar por el anden ni dejar tarea de
 * guardado, que el movimiento quede marcado como carga inicial y no como un recibo, que la
 * pantalla sugiera picking para el primer lote de cada producto, y que avise cuando alguien
 * carga al reves y deja en picking un lote que vence despues.
 */
const db = await bootDb()
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const falla = async (sql, params) =>
  db.query(sql, params).then(
    () => null,
    (e) => e.message,
  )

const { id: jefe } = await one(
  `insert into auth.users (email) values ('inventarios@ejemplo.test') returning id`,
)
const { id: visita } = await one(
  `insert into auth.users (email) values ('visita@ejemplo.test') returning id`,
)
await db.query(`update profile set role = 'inventarios' where id = '${jefe}'`)
await db.query(`update profile set role = 'solo_lectura' where id = '${visita}'`)
const como = (id) => db.query(`select set_config('request.jwt.claim.sub', '${id}', false)`)

await como(jefe)

const { id: galleta } = await one(
  `insert into product (sku, name, base_uom, base_code, requires_fefo)
   values ('61244C4', 'Galleta carton', 'ST', '61244', true) returning id`,
)
const { id: cajaGalleta } = await one(
  `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 24)
   returning id`,
  [galleta],
)
await one(
  `insert into barcode (packaging_level_id, code, symbology) values ($1, '70123456789015', 'GTIN14')`,
  [cajaGalleta],
)
await one(
  `insert into product (sku, name, base_uom) values ('SIN-CASE', 'Producto sin corrugado', 'ST')`,
)

// Picking nace vacia: aqui se le pasan dos posiciones de piso, como las armaria el jefe.
const { id: areaPicking } = await one(`select id from area where code = 'PICKING'`)
const piso = await db.query(
  `select id, code from location where level = 0 and usage_code = 'PRODUCTO' order by code limit 2`,
)
for (const p of piso.rows) {
  await db.query(`update location_area set valid_to = now() where location_id = $1 and valid_to is null`, [p.id])
  await db.query(`insert into location_area (location_id, area_id) values ($1, $2)`, [p.id, areaPicking])
}
const [pickA] = piso.rows

// --- permisos ----------------------------------------------------------------------------

await como(visita)
const sinPermiso = await falla(
  `select * from cargar_inicial('61244C4', 10, $1, 'L-1', '2027-01-31')`,
  [pickA.code],
)
check(sinPermiso?.includes('permiso'), 'quien solo consulta no crea inventario de la nada')

// --- lo que no se deja pasar -------------------------------------------------------------

await como(jefe)

const sinCajas = await falla(
  `select * from cargar_inicial('61244C4', 0, $1, 'L-1', '2027-01-31')`,
  [pickA.code],
)
check(sinCajas?.includes('cuántas cajas'), 'no se carga sin decir cuantas cajas hay')

const sinLote = await falla(
  `select * from cargar_inicial('61244C4', 10, $1, null, '2027-01-31')`,
  [pickA.code],
)
check(sinLote?.includes('lote'), 'el lote es obligatorio')

const sinVencimiento = await falla(
  `select * from cargar_inicial('61244C4', 10, $1, 'L-1', null)`,
  [pickA.code],
)
check(sinVencimiento?.includes('FEFO'), 'y el vencimiento, porque de ahi sale el FEFO de la bodega')

const faltaCorrugado = await falla(
  `select * from cargar_inicial('SIN-CASE', 10, $1, 'L-1', '2027-01-31')`,
  [pickA.code],
)
check(faltaCorrugado?.includes('corrugado'), 'sin corrugado en el maestro no se cuenta por cajas')

const inventada = await falla(
  `select * from cargar_inicial('61244C4', 10, 'NO-EXISTE', 'L-1', '2027-01-31')`,
)
check(inventada?.includes('No hay ninguna posición'), 'una posicion inventada se rechaza')

const { code: andenCode } = await one(`select code from location where code like 'STG-AND-N-%' limit 1`)
const enAnden = await one(
  `select * from cargar_inicial('61244C4', 10, $1, 'L-1', '2027-01-31')`,
  [andenCode],
)
check(enAnden.posicion === andenCode, 'un anden guarda producto, asi que se deja cargar ahi')

// --- la sugerencia -----------------------------------------------------------------------

const primera = await one(`select * from sugerir_posicion_inicial('61244C4', '2026-12-31')`)
check(primera.es_picking === true, 'el primer lote de un producto se sugiere en picking')
check(
  piso.rows.some((p) => p.code === primera.code),
  'y la posicion sugerida es una de las que el jefe marco como picking',
)

// --- cargar --------------------------------------------------------------------------------

const cerca = await one(
  `select * from cargar_inicial('61244C4', 30, $1, 'L-VIEJO', '2026-12-31')`,
  [primera.code],
)
check(cerca.posicion === primera.code, 'se carga en la posicion sugerida')
check(cerca.sku === '61244C4', 'y dice que producto quedo ahi')
check(Number(cerca.cases) === 30, 'con las cajas que contaron')
check(cerca.matricula.startsWith('WMS-'), 'sin etiqueta, el WMS le pone matricula al pallet')
check(cerca.aviso === null, 'el primero nunca puede estar fuera de orden')

const saldo = await one(
  `select qty_base, lot, expiry_date from stock where location_id = $1 and product_id = $2`,
  [primera.location_id, galleta],
)
check(Number(saldo.qty_base) === 720, '30 cajas de 24 quedan como 720 unidades base')
check(saldo.lot === 'L-VIEJO', 'con su lote')

const mov = await one(
  `select type, reason_code, from_location_id from stock_movement
   where product_id = $1 and to_location_id = $2 order by id desc limit 1`,
  [galleta, primera.location_id],
)
check(mov.type === 'ADJUST', 'no es un recibo: es un ajuste de entrada')
check(mov.reason_code === 'CARGA_INICIAL', 'y se puede separar de todo lo demas por el motivo')
check(mov.from_location_id === null, 'no viene de ningun lado, porque ya estaba adentro')

const tareas = await one(
  `select count(*)::int as n from task where type = 'PUTAWAY' and product_id = $1`,
  [galleta],
)
check(tareas.n === 0, 'y no deja tarea de guardado: el producto ya esta en su lugar')

// --- el segundo lote ya no va a picking ---------------------------------------------------

const segunda = await one(`select * from sugerir_posicion_inicial('61244C4', '2027-06-30')`)
check(segunda.es_picking === false, 'con picking ya surtido, el resto se sugiere en almacen')
check(segunda.code !== primera.code, 'y no manda a apilar sobre lo que acaba de cargar')

const lejos = await one(
  `select * from cargar_inicial('61244C4', 40, $1, 'L-NUEVO', '2027-06-30', 'PAL-NEST-9')`,
  [segunda.code],
)
check(lejos.matricula === 'PAL-NEST-9', 'si el pallet ya trae etiqueta, esa es su matricula')
check(lejos.aviso === null, 'cargar de menor a mayor vencimiento no genera aviso')

const procedencia = await one(`select source from lpn where code = 'PAL-NEST-9'`)
check(procedencia.source === 'NEST', 'y queda marcada como etiqueta de planta')
const propia = await one(`select source from lpn where code = $1`, [cerca.matricula])
check(propia.source === 'PROVISIONAL', 'mientras la que invento el WMS queda como provisional')

const repetida = await falla(
  `select * from cargar_inicial('61244C4', 40, $1, 'L-NUEVO', '2027-06-30', 'PAL-NEST-9')`,
  [segunda.code],
)
check(repetida?.includes('ya está en el sistema'), 'la misma matricula no entra dos veces')

// --- cargar al reves avisa ---------------------------------------------------------------

const tercera = await one(`select * from sugerir_posicion_inicial('61244C4', '2026-06-30')`)
const alReves = await one(
  `select * from cargar_inicial('61244C4', 20, $1, 'L-MAS-VIEJO', '2026-06-30')`,
  [tercera.code],
)
check(
  alReves.aviso?.includes('debería ir a picking'),
  'si llega un lote que vence antes que el de picking, lo dice en el momento',
)
check(alReves.aviso?.includes('30/06/2026'), 'con la fecha del lote que se acaba de cargar')
check(alReves.aviso?.includes(primera.code), 'y la posicion de picking que habria que cambiar')

// --- lo que ya se cargo de un producto ---------------------------------------------------

const cargado = await db.query(`select * from carga_inicial_de('61244C4')`)
check(cargado.rows.length === 4, 'la pantalla enseña todo lo que se cargo de ese producto')
check(
  cargado.rows[0].vence.toISOString().startsWith('2026-06-30'),
  'ordenado del que vence antes al que vence despues',
)
check(Number(cargado.rows[0].cajas) === 20, 'en cajas, que es como lo cuenta la gente')
const enPicking = cargado.rows.filter((r) => r.en_picking)
check(enPicking.length === 1, 'y marca cual esta en picking')
check(enPicking[0].posicion === primera.code, 'que es la que se cargo primero')

const porCodigo = await db.query(`select * from carga_inicial_de('70123456789015')`)
check(porCodigo.rows.length === 4, 'y se puede consultar escaneando una caja')

await db.close()
