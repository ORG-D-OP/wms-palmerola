import { bootDb, check } from './lib/boot-db.mjs'

const db = await bootDb()
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const fails = async (sql, params) =>
  db.query(sql, params).then(
    () => null,
    (e) => e.message,
  )

const { id: productId } = await one(
  `insert into product (sku, name, base_uom, requires_fefo)
   values ('98914.4', 'Galleta surtida 24x115g', 'ST', true) returning id`,
)
const { id: caseId } = await one(
  `insert into packaging_level (product_id, code, qty_base_units, is_pick_unit)
   values ($1, 'CASE', 24, true) returning id`,
  [productId],
)
const [recibo, rack] = (
  await db.query(
    `select id from location where code in ('F1-001-01', 'R-SNK-L01-B01-N1-P1') order by code`,
  )
).rows
const { id: lpnId } = await one(
  `insert into lpn (code) values ('LPN0000000001') returning id`,
)

const post = (args) =>
  one(
    `select post_movement(
       $1::movement_type, $2::uuid, $3::numeric, $4::uuid, $5::uuid, $6::uuid,
       $7::text, $8::date, $9::text, $10::text, $11::uuid, null, null, $12::text
     ) as id`,
    args,
  )

await post(['RECEIPT', productId, 144, null, recibo.id, lpnId, 'L2601', '2027-04-24', null, null, caseId, 'recv-1'])
const tras = await one('select qty_base from stock where location_id = $1', [recibo.id])
check(Number(tras.qty_base) === 144, 'la recepcion deja 144 en la posicion de recibo')

const repetido = await post(['RECEIPT', productId, 144, null, recibo.id, lpnId, 'L2601', '2027-04-24', null, null, caseId, 'recv-1'])
const total = await one('select sum(qty_base) as q from stock where location_id = $1', [recibo.id])
check(Number(total.q) === 144, 'reenviar el mismo movimiento no duplica existencia')

await post(['PUTAWAY', productId, 144, recibo.id, rack.id, lpnId, 'L2601', '2027-04-24', null, null, caseId, 'put-1'])
const origen = await one('select qty_base from stock where location_id = $1', [recibo.id])
const destino = await one('select qty_base from stock where location_id = $1', [rack.id])
check(
  Number(origen.qty_base) === 0 && Number(destino.qty_base) === 144,
  'el traslado mueve las 144 cajas al rack',
)

const deMas = await fails(
  `select post_movement('PICK'::movement_type, $1::uuid, 200::numeric, $2::uuid, null, $3::uuid,
                        'L2601'::text, '2027-04-24'::date)`,
  [productId, rack.id, lpnId],
)
check(
  deMas?.includes('hay 144.000 y se piden 200'),
  'no se puede sacar mas de lo que hay, y el error dice cuanto hay',
)

const otroLote = await fails(
  `select post_movement('PICK'::movement_type, $1::uuid, 1::numeric, $2::uuid, null, null,
                        'L9999'::text, '2027-04-24'::date)`,
  [productId, rack.id],
)
check(otroLote?.includes('Sin existencia'), 'no se puede sacar de un lote que no esta ahi')

const sinMotivo = await fails(
  `select post_movement('ADJUST'::movement_type, $1::uuid, 1::numeric, $2::uuid)`,
  [productId, rack.id],
)
check(sinMotivo?.includes('motivo'), 'un ajuste sin motivo se rechaza')

const sinNota = await fails(
  `select post_movement('ADJUST'::movement_type, $1::uuid, 1::numeric, $2::uuid, null, null,
                        null, null, 'ROTO'::text)`,
  [productId, rack.id],
)
check(sinNota?.includes('nota'), 'un motivo que exige nota se rechaza sin ella')

await post(['ADJUST', productId, 2, rack.id, null, lpnId, 'L2601', '2027-04-24', 'ROTO', 'Caida de montacargas', caseId, 'adj-1'])
const trasAjuste = await one(
  'select qty_base from stock where location_id = $1 and qty_base > 0',
  [rack.id],
)
check(Number(trasAjuste.qty_base) === 142, 'la merma descuenta del saldo')

const editar = await fails('update stock_movement set qty_base = 1 where id = 1')
check(editar?.includes('inmutable'), 'el libro mayor no se puede editar')

const borrar = await fails('delete from stock_movement where id = 1')
check(borrar?.includes('inmutable'), 'el libro mayor no se puede borrar')

const roto = await one('select first_broken_id from verify_ledger()')
check(roto?.first_broken_id == null, 'la cadena de hash del ledger esta intacta')

const desdeLedger = await one(
  `select coalesce(sum(case when to_location_id = $1 then qty_base else 0 end), 0)
        - coalesce(sum(case when from_location_id = $1 then qty_base else 0 end), 0) as q
   from stock_movement`,
  [rack.id],
)
check(Number(desdeLedger.q) === 142, 'el saldo se reconstruye desde el ledger y coincide')

check(repetido.id != null, 'la clave de idempotencia devuelve el movimiento original')
