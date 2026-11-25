import { bootDb, check } from './lib/boot-db.mjs'

/**
 * Que es el producto, dicho por el que lo recibe.
 *
 * Un material que llego en un camion sin estar en el maestro no trae clase, y sin clase
 * `grupo_del_producto` lo trata como alimento: acabaria durmiendo al lado de la comida. El
 * anden es el unico sitio donde alguien lo tiene delante, asi que ahi se dice.
 *
 * Lo que aqui se fija: que el camion ensene cuales le faltan, que decirlo lo guarde, y que
 * nadie pueda cambiar desde el anden lo que el maestro ya decidio.
 */
const db = await bootDb()
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const todas = async (sql, params) => (await db.query(sql, params)).rows
const falla = async (sql, params) =>
  db.query(sql, params).then(
    () => null,
    (e) => e.message,
  )

const { id: chequeador } = await one(
  `insert into auth.users (email) values ('chequeador@ejemplo.test') returning id`,
)
await db.query(
  `update profile set is_active = true, approved_at = now(), role = 'chequeador' where id = '${chequeador}'`,
)
await db.query(`select set_config('request.jwt.claim.sub', '${chequeador}', false)`)

// --- el material que llego sin maestro ----------------------------------------------------

const nuevo = await one(`select producto_de_sap('71001.6', 'Jabon Azul 6s') as id`)
check(nuevo.id !== null, 'el material que no esta en el maestro se da de alta con su nombre')

const otra = await one(`select producto_de_sap('71001.6', 'Jabon Azul 6s') as id`)
check(otra.id === nuevo.id, 'y la segunda vez devuelve el que ya existe')

const sinNombre = await one(`select producto_de_sap('71002.6', null) as id`)
check(sinNombre.id === null, 'sin nombre no hay con que darlo de alta')

const alta = await one(`select * from product where id = $1`, [nuevo.id])
check(alta.base_uom === 'ST', 'nace en la unidad en la que SAP cuenta')
check(alta.requires_fefo === true, 'y pidiendo vencimiento, que es lo que hace todo alimento')
check(alta.contamination_class === null, 'y sin clase, que es lo que nadie puede inventar')
check(alta.base_code === '71001' && alta.variant === '.6', 'el SKU se parte como el del maestro')

const empaques = await todas(
  `select code, qty_base_units from packaging_level where product_id = $1 order by code`,
  [nuevo.id],
)
check(empaques.length === 2, 'con sus dos empaques: sin corrugado no se puede recibir por cajas')
check(
  empaques.find((e) => e.code === 'CASE')?.qty_base_units === '6.000',
  'y el corrugado sale del numero del nombre',
)

// --- el camion ensena lo que le falta decir -----------------------------------------------

const { id: doc } = await one(
  `insert into inbound_doc (pedido, status, sin_aviso)
   values ('60299001', 'ARRIVED', true) returning id`,
)
await one(
  `insert into inbound_line (doc_id, line_no, product_id, qty_cases) values ($1, 1, $2, 30)`,
  [doc, nuevo.id],
)

const faltan = await todas(`select * from productos_sin_clase($1)`, [doc])
check(faltan.length === 1 && faltan[0].sku === '71001.6', 'el camion dice cual no sabe que es')

// --- y el que recibe lo dice ---------------------------------------------------------------

await one(`select poner_clase($1, 'QUIMICO')`, [nuevo.id])
const dicho = await one(`select contamination_class as c from product where id = $1`, [nuevo.id])
check(dicho.c === 'QUIMICO', 'lo que dice el que recibe queda puesto')

const grupo = await one(`select grupo_del_producto($1) as g`, [nuevo.id])
check(grupo.g === 'NO_ALIMENTO', 'y desde ahi ya no duerme con la comida')

check((await todas(`select * from productos_sin_clase($1)`, [doc])).length === 0,
  'y el camion deja de pedirlo')

await one(`select poner_clase($1, 'ALIMENTO')`, [nuevo.id])
const quieto = await one(`select contamination_class as c from product where id = $1`, [nuevo.id])
check(quieto.c === 'QUIMICO', 'lo que ya estaba decidido no se cambia desde el anden')

// --- y no lo toca cualquiera ---------------------------------------------------------------

const { id: solo } = await one(
  `insert into auth.users (email) values ('lectura@ejemplo.test') returning id`,
)
await db.query(
  `update profile set is_active = true, approved_at = now(), role = 'solo_lectura' where id = '${solo}'`,
)
await db.query(`select set_config('request.jwt.claim.sub', '${solo}', false)`)
const { id: tercero } = await one(`select producto_de_sap('71003.6', 'Cloro 6s') as id`)
check(
  (await falla(`select poner_clase($1, 'QUIMICO')`, [tercero]))?.includes('permiso') === true,
  'el que solo mira no cambia un producto',
)
