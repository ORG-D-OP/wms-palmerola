import { bootDb, check } from './lib/boot-db.mjs'

/**
 * Recibir deja de ser teclear: el operario teclea el pedido una vez por camion y despues
 * solo escanea la etiqueta que el pallet trae de planta. El documento sabe el material, el
 * lote, el vencimiento y la cantidad, asi que las cuatro digitaciones por pallet —las dos
 * que el operario no puede verificar— desaparecen.
 *
 * Y el DUN-14 no distingue variantes: 81 codigos los comparten 175 productos. Por eso el
 * codigo de caja es confirmacion y se compara contra el producto base, no contra el SKU.
 */
const db = await bootDb()
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const fails = async (sql, params) =>
  db.query(sql, params).then(
    () => null,
    (e) => e.message,
  )

const { id: auxiliar } = await one(
  `insert into auth.users (email) values ('aux@ejemplo.test') returning id`,
)
await db.query(`update profile set is_active = true, approved_at = now(), role = 'auxiliar' where id = '${auxiliar}'`)
const como = (id) => db.query(`select set_config('request.jwt.claim.sub', '${id}', false)`)

// Dos variantes del mismo producto base, con el mismo DUN-14: es el caso real.
const { id: normal } = await one(
  `insert into product (sku, name, base_uom, base_code, variant)
   values ('61244.4', 'Galleta 24s', 'ST', '61244', '.4') returning id`,
)
const { id: promo } = await one(
  `insert into product (sku, name, base_uom, base_code, variant)
   values ('61244P4', 'Galleta 24s promo', 'ST', '61244', 'P4') returning id`,
)
const { id: otro } = await one(
  `insert into product (sku, name, base_uom, base_code, variant)
   values ('60340.4', 'Ranchitas', 'ST', '60340', '.4') returning id`,
)
for (const p of [normal, promo, otro]) {
  await one(
    `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 24)
     returning id`,
    [p],
  )
}
await one(
  `insert into barcode (packaging_level_id, code, symbology, is_primary)
   values ((select id from packaging_level where product_id = $1), '10750894612444', 'GTIN14', true)
   returning code`,
  [normal],
)
await one(
  `insert into barcode (packaging_level_id, code, symbology, is_primary)
   values ((select id from packaging_level where product_id = $1), '10750894603401', 'GTIN14', true)
   returning code`,
  [otro],
)

const { id: anden } = await one(`select id from location where code = 'STG-AND-N-01'`)

// El documento, como lo deja el archivo de SAP: el pedido con sus ceros quitados.
const { id: doc } = await one(
  `insert into inbound_doc (pedido, status) values ('12345678', 'EXPECTED') returning id`,
)
await db.query(
  `insert into inbound_pallet (doc_id, pallet_code, product_id, qty_cases, lot, expiry_date)
   values ($1, '000100123456', $2, 48, 'L2601', '2027-04-24'),
          ($1, '000100123457', $3, 36, 'L2602', '2027-05-10')`,
  [doc, normal, promo],
)

// ---------------------------------------------------------------------------------------
// Lo que el operario ve antes de escanear
// ---------------------------------------------------------------------------------------

await como(auxiliar)
const encontrado = await one(`select * from buscar_ingreso('0012345678')`)
check(encontrado?.pedido === '12345678', 'el pedido se encuentra aunque venga con ceros adelante')
check(encontrado?.pallets === 2 && encontrado?.recibidos === 0, 'el documento dice cuantos faltan')

const inventado = await one(`select count(*)::int as n from buscar_ingreso('99999999')`)
check(inventado.n === 0, 'un pedido que no existe no devuelve nada que escanear')

// ---------------------------------------------------------------------------------------
// Recibir es escanear la etiqueta de planta
// ---------------------------------------------------------------------------------------

const r = await one(
  `select * from recibir_del_documento('12345678', '000100123456', $1, null, 0::smallint)`,
  [anden],
)
check(r?.sku === '61244.4', 'el documento dice el material: no se teclea')
check(Number(r?.cases) === 48, 'y dice la cantidad')
check(r?.recibidos === 1 && r?.pallets === 2, 'la pantalla sabe cuanto falta del camion')

const guardado = await one(
  `select s.qty_base, s.lot, s.expiry_date, lp.code
   from stock s join lpn lp on lp.id = s.lpn_id where lp.code = '000100123456'`,
)
check(Number(guardado?.qty_base) === 48 * 24, '48 cajas son 1,152 unidades base')
check(guardado?.lot === 'L2601', 'el lote viene del documento, no del teclado')
check(
  guardado?.expiry_date?.toISOString?.().slice(0, 10) === '2027-04-24',
  'y el vencimiento tambien',
)

const repetido = await fails(
  `select * from recibir_del_documento('12345678', '000100123456', $1)`,
  [anden],
)
check(repetido?.includes('ya se recibió'), 'el mismo pallet no entra dos veces')

const ajeno = await fails(
  `select * from recibir_del_documento('12345678', 'PAL-DE-OTRO', $1)`,
  [anden],
)
check(ajeno?.includes('no es de este pedido'), 'un pallet de otro camion se detiene')

// ---------------------------------------------------------------------------------------
// El codigo de caja confirma el producto base, que es lo unico que puede confirmar
// ---------------------------------------------------------------------------------------

const confirmado = await one(
  `select * from recibir_del_documento('12345678', '000100123457', $1, '10750894612444', 0::smallint)`,
  [anden],
)
check(
  confirmado?.sku === '61244P4',
  'el DUN-14 de la variante normal confirma la promo: comparten base y la caja es la misma',
)

const progreso = await one(`select recibidos, pallets, status from inbound_progress where id = $1`, [
  doc,
])
check(progreso?.recibidos === 2, 'el camion queda completo')
check(progreso?.status === 'CLOSED', 'y el documento se cierra solo')

const { id: doc2 } = await one(
  `insert into inbound_doc (pedido, status) values ('87654321', 'EXPECTED') returning id`,
)
await db.query(
  `insert into inbound_pallet (doc_id, pallet_code, product_id, qty_cases, lot)
   values ($1, '000100987654', $2, 20, 'L2603')`,
  [doc2, normal],
)
const equivocado = await fails(
  `select * from recibir_del_documento('87654321', '000100987654', $1, '10750894603401')`,
  [anden],
)
check(
  equivocado?.includes('La caja no es de'),
  'una caja de otro producto base se detiene antes de guardar nada',
)

const desconocido = await fails(
  `select * from recibir_del_documento('87654321', '000100987654', $1, '99999999999999')`,
  [anden],
)
check(desconocido?.includes('no está en el maestro'), 'un codigo que no esta en el maestro se detiene')

await db.close()
