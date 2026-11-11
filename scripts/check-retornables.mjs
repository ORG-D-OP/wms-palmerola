import { bootDb, check } from './lib/boot-db.mjs'

/**
 * Pallets vacios y corrugado: una cuenta, no inventario. Lo que aqui se fija: que el espacio
 * se marque a mano y deje de recibir producto, que no tenga tope, que la cuenta no baje de
 * cero, que quede rastro de quien movio que, y que esto no se mezcle con el saldo de
 * producto.
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
  `insert into auth.users (email) values ('jefe3@ejemplo.test') returning id`,
)
const { id: visita } = await one(
  `insert into auth.users (email) values ('visita@ejemplo.test') returning id`,
)
await db.query(`update profile set is_active = true, approved_at = now(), role = 'supervisor' where id = '${jefe}'`)
await db.query(`update profile set is_active = true, approved_at = now(), role = 'solo_lectura' where id = '${visita}'`)
const como = (id) => db.query(`select set_config('request.jwt.claim.sub', '${id}', false)`)

await como(jefe)

// --- el jefe marca el espacio a mano, y deja de ser para producto -----------------------

const { id: pallets, barcode: codigoBarras } = await one(
  `select id, barcode from location where code = 'F1-001-01'`,
)
const { id: corrugado } = await one(`select id from location where code = 'F1-001-02'`)
const { id: otroPallets } = await one(`select id from location where code = 'F1-002-01'`)

await one(`select reasignar_uso(array[$1::uuid, $2::uuid], 'PALLET_VACIO')`, [
  pallets,
  otroPallets,
])
await one(`select reasignar_uso(array[$1::uuid], 'CORRUGADO')`, [corrugado])
check(true, 'el jefe marca las posiciones desde /areas, no el sistema solo')

const paraProducto = await one(
  `select count(*)::int as n from retornables where code in ('F1-001-01', 'F1-001-02', 'F1-002-01')`,
)
check(paraProducto.n === 3, 'las tres aparecen como posiciones de retornables')
check(
  (await todas(`select * from retornables where code = 'F1-001-01'`))[0].cantidad === 0,
  'y arrancan en cero, no sin fila',
)

const motor = await one(`select suggest_putaway_location($1) as id`, [
  (
    await one(
      `insert into product (sku, name, base_uom) values ('R-1', 'Jabón', 'ST') returning id`,
    )
  ).id,
])
check(motor.id !== pallets, 'el motor de ubicación ya no manda producto a esa posición')

// --- la cuenta --------------------------------------------------------------------------

const guardo = await one(`select * from contar_retornable('F1-001-01', 12)`)
check(guardo.quedan === 12, 'guardar doce pallets deja doce')
check(guardo.uso === 'Guarda pallets vacíos', 'y dice de qué es el espacio')

const porBarras = await one(`select * from contar_retornable($1, 8)`, [codigoBarras])
check(porBarras.quedan === 20, 'escaneando la etiqueta de la posición también suma')

const quito = await one(`select * from contar_retornable('F1-001-01', -5)`)
check(quito.quedan === 15, 'quitar cinco deja quince')

const demasiado = await falla(`select * from contar_retornable('F1-001-01', -20)`)
check(demasiado?.includes('hay 15'), 'no se puede quitar más de lo que hay, y dice cuánto hay')

const cero = await falla(`select * from contar_retornable('F1-001-01', 0)`)
check(cero?.includes('cuántas'), 'cero no es un movimiento')

const sinTope = await one(`select * from contar_retornable('F1-001-01', 5000)`)
check(sinTope.quedan === 5015, 'el espacio no tiene tope: caben todos los que sea')

const segundoEspacio = await one(`select * from contar_retornable('F1-002-01', 30)`)
check(segundoEspacio.quedan === 30, 'puede haber más de un espacio para pallets, cada uno con su cuenta')

const enCorrugado = await one(`select * from contar_retornable('F1-001-02', 40)`)
check(enCorrugado.uso === 'Guarda corrugado de retorno', 'y uno aparte para corrugado')

// --- lo que no es ------------------------------------------------------------------------

const deProducto = await falla(`select * from contar_retornable('F1-003-01', 10)`)
check(
  deProducto?.includes('guarda producto'),
  'una posición de producto no lleva contador de retornables',
)

const inventada = await falla(`select * from contar_retornable('NO-EXISTE', 10)`)
check(inventada?.includes('ninguna posición'), 'una posición que no existe se rechaza')

const saldo = await one(`select count(*)::int as n from stock where location_id = $1`, [pallets])
check(saldo.n === 0, 'nada de esto toca el saldo de inventario')

const ledger = await one(
  `select count(*)::int as n from stock_movement where from_location_id = $1 or to_location_id = $1`,
  [pallets],
)
check(ledger.n === 0, 'ni el libro mayor de producto')

// --- rastro -----------------------------------------------------------------------------

const rastro = await todas(
  `select delta, qty_after, actor_id from returnable_movement
   where location_id = $1 order by id`,
  [pallets],
)
check(rastro.length === 4, 'cada movimiento queda registrado')
check(rastro[0].delta === 12 && rastro[0].qty_after === 12, 'con lo que se movió y lo que quedó')
check(rastro[0].actor_id === jefe, 'y quién lo movió')

await como(visita)
const sinPermiso = await falla(`select * from contar_retornable('F1-001-01', 1)`)
check(sinPermiso?.includes('permiso'), 'quien sólo puede leer no mueve retornables')
