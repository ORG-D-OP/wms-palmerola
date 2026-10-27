import { bootDb, check } from './lib/boot-db.mjs'

// Caso real del maestro de origen: galleta de 24 unidades por corrugado, 144 cajas por
// pallet, y dos SKU que comparten el mismo GTIN-14.
const GALLETA = { sku: '98914.4', units: 24, casesPerLayer: 18, layers: 8, dun14: '17802225689141' }
const GEMELO = { sku: '98907.6', dun14: GALLETA.dun14 }

const db = await bootDb()
const one = async (sql, params) => (await db.query(sql, params)).rows[0]

const { id: productId } = await one(
  `insert into product (sku, name, base_uom, contamination_class, requires_fefo, shelf_life_days)
   values ($1, 'Galleta surtida 24x115g', 'ST', 'ALIMENTO', true, 180) returning id`,
  [GALLETA.sku],
)

const readyAtStart = await one('select * from product_readiness where id = $1', [productId])
check(!readyAtStart.tiene_corrugado, 'un producto sin corrugado no esta listo para almacenar')

const { id: caseId } = await one(
  `insert into packaging_level
     (product_id, code, qty_base_units, length_mm, width_mm, height_mm, gross_weight_g, is_pick_unit)
   values ($1, 'CASE', $2, 210, 190, 320, 116600, true) returning id`,
  [productId, GALLETA.units],
)

await one(
  `insert into barcode (packaging_level_id, code, symbology, is_primary)
   values ($1, $2, 'GTIN14', true) returning id`,
  [caseId, GALLETA.dun14],
)

const pallet = await one(
  `insert into pallet_config (product_id, pallet_type_code, cases_per_layer, layers, cases_per_pallet)
   values ($1, 'STD', $2, $3, $4) returning cases_per_pallet`,
  [productId, GALLETA.casesPerLayer, GALLETA.layers, GALLETA.casesPerLayer * GALLETA.layers],
)
check(pallet.cases_per_pallet === 144, 'cajas por pallet queda en 144')

const patronTorcido = await db
  .query(
    `insert into pallet_config (product_id, pallet_type_code, cases_per_layer, layers, cases_per_pallet)
     values ($1, 'EUR', 10, 10, 99)`,
    [productId],
  )
  .then(() => null)
  .catch((e) => e.message)
check(patronTorcido !== null, 'un patron que no cuadra con el total se rechaza')

const ready = await one('select * from product_readiness where id = $1', [productId])
check(
  ready.tiene_clase && ready.tiene_corrugado && ready.tiene_estiba && ready.tiene_codigo,
  'con corrugado, estiba y codigo el producto queda listo',
)

const duplicadoPorNivel = await db
  .query(
    `insert into barcode (packaging_level_id, code, symbology) values ($1, $2, 'GTIN14')`,
    [caseId, GALLETA.dun14],
  )
  .then(() => null)
  .catch((e) => e.message)
check(duplicadoPorNivel !== null, 'el mismo codigo no se repite dentro de un empaque')

const { id: gemeloId } = await one(
  `insert into product (sku, name, base_uom) values ($1, 'Galleta avena 24x115g', 'ST') returning id`,
  [GEMELO.sku],
)
const { id: gemeloCase } = await one(
  `insert into packaging_level (product_id, code, qty_base_units)
   values ($1, 'CASE', 24) returning id`,
  [gemeloId],
)
await one(
  `insert into barcode (packaging_level_id, code, symbology, is_primary)
   values ($1, $2, 'GTIN14', true) returning id`,
  [gemeloCase, GEMELO.dun14],
)

const conflicto = await one('select * from barcode_conflict where code = $1', [GALLETA.dun14])
check(conflicto?.productos === 2, 'un codigo compartido entre dos SKU sale como conflicto')

const tras = await one('select * from product_readiness where id = $1', [productId])
check(!tras.codigo_sin_conflicto, 'un producto con codigo en conflicto deja de estar listo')

const dosPick = await db
  .query(
    `insert into packaging_level (product_id, code, qty_base_units, is_pick_unit)
     values ($1, 'UNIT', 1, true)`,
    [productId],
  )
  .then(() => null)
  .catch((e) => e.message)
check(dosPick !== null, 'un producto no puede tener dos unidades de picking')

// Asignacion de codigo verificado
const { id: quien } = await one(
  `insert into auth.users (email) values ('admin@ejemplo.test') returning id`,
)
await db.query(`update profile set role = 'admin' where id = '${quien}'`)
await db.query(`select set_config('request.jwt.claim.sub', '${quien}', false)`)

const asignado = await one(`select * from assign_barcode($1, '7501234567890')`, [gemeloId])
check(asignado.is_primary && asignado.verified_at !== null, 'el codigo asignado queda verificado')

const ajeno = await db
  .query(`select * from assign_barcode($1, '7501234567890')`, [productId])
  .then(() => null, (e) => e.message)
check(
  ajeno?.includes('ya esta asignado al producto'),
  'un codigo de otro producto se rechaza nombrando cual',
)

await db.query(`update profile set role = 'operador_picking' where id = '${quien}'`)
const sinPermiso = await db
  .query(`select * from assign_barcode($1, '7509999999999')`, [productId])
  .then(() => null, (e) => e.message)
check(sinPermiso?.includes('permiso'), 'un operario no puede asignar codigos')
