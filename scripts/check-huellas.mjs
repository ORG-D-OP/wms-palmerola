import { bootDb, check } from './lib/boot-db.mjs'
import { huella } from '../lib/sap/huella.ts'

/**
 * Los complementos y las huellas.
 *
 * SAP no marca los complementos: un transporte que traia 20 lineas aparece en el archivo
 * siguiente con 27 y nada dice cuales son las siete nuevas. Por eso el documento se rehace
 * entero cada vez, y por eso la unidad que se manda o no se manda es el documento, nunca la
 * fila.
 *
 * Lo que aqui se fija: que el complemento entre, que la huella sea estable y cambie cuando el
 * documento cambia, que la base devuelva solo lo que conoce, y sobre todo que **a un camion ya
 * abierto no se le guarde la huella**: si se le guardara, su complemento no volveria a
 * ofrecerse nunca y se perderia sin que nadie se entere.
 */

const db = await bootDb()
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const todas = async (sql, params) => (await db.query(sql, params)).rows

await one(
  `insert into product (sku, name, base_uom, base_code, variant)
   values ('61244.4', 'Galleta 24s', 'ST', '61244', '.4')`,
)
const { id: producto } = await one(`select id from product where sku = '61244.4'`)
await one(`insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 24)`, [
  producto,
])

const linea = (transporte, posicion, cantidad) => ({
  transporte,
  entrega: '700157391',
  posicion,
  material: '61244.4',
  cantidad,
  um: 'CA',
  cliente: 'Pulpería del Centro',
})

const cargar = async (filas) => {
  const huellas = {}
  for (const f of filas) {
    const suyas = filas.filter((x) => x.transporte === f.transporte)
    huellas[f.transporte] = huella(suyas)
  }
  const { r } = await one(`select cargar_despachos($1::jsonb, $2::jsonb) as r`, [
    JSON.stringify(filas),
    JSON.stringify(huellas),
  ])
  return r
}

const lineasDe = async (code) =>
  (
    await todas(
      `select l.line_no, l.qty_base from order_line l
       join sales_order o on o.id = l.order_id where o.code = $1 order by l.line_no`,
      [code],
    )
  ).map((r) => Number(r.qty_base))

// --- la huella ---------------------------------------------------------------------------

const unas = [linea('A', 10, 5), linea('A', 20, 7)]
check(huella(unas) === huella(unas), 'la misma lista da la misma huella')
check(
  huella(unas) === huella([...unas].reverse()),
  'y el orden de las líneas no la cambia: el mismo camión puede venir al revés',
)
check(
  huella(unas) !== huella([...unas, linea('A', 30, 9)]),
  'una línea más cambia la huella: eso es un complemento',
)
check(
  huella(unas) !== huella([linea('A', 10, 5), linea('A', 20, 8)]),
  'y cambiar una cantidad también',
)

// --- el complemento entra ------------------------------------------------------------------

check((await cargar(unas)).lineas === 2, 'el camión entra con sus dos líneas')
check((await lineasDe('A')).join(' ') === '120 168', 'y quedan las cajas en unidades base')

const conComplemento = [...unas, linea('A', 30, 9)]
check((await cargar(conComplemento)).lineas === 3, 'el complemento de siete líneas entra entero')
check(
  (await lineasDe('A')).join(' ') === '120 168 216',
  'y el camión queda con todas, no sólo con la nueva',
)

// --- lo que no cambió no se manda -----------------------------------------------------------

const { h } = await one(`select huellas_de('DESPACHO', array['A','Z']) as h`)
check(h.A === huella(conComplemento), 'la base devuelve la huella con que se cargó el camión')
check(!('Z' in h), 'y no inventa nada de un camión que no conoce')

const vacio = await one(`select huellas_de('DESPACHO', array[]::text[]) as h`)
check(Object.keys(vacio.h).length === 0, 'preguntar por nada devuelve un objeto vacío, no nulo')

// --- un camión ya abierto no se toca, y se dice ----------------------------------------------

await db.query(`update sales_order set status = 'RELEASED' where code = 'A'`)
const masTarde = [...conComplemento, linea('A', 40, 11)]
const res = await cargar(masTarde)
check(res.lineas === 0, 'al camión abierto no se le reescriben las líneas')
check(res.ya_abiertos === 1, 'pero se cuenta y se dice que llegó un complemento para él')
check(
  (await lineasDe('A')).join(' ') === '120 168 216',
  'lo que ya estaba repartido se queda como estaba',
)

const despues = await one(`select huellas_de('DESPACHO', array['A']) as h`)
check(
  despues.h.A === huella(conComplemento),
  'y su huella NO se actualiza: el complemento se vuelve a ofrecer en la próxima subida',
)

// --- el camión nuevo del mismo archivo sí entra ----------------------------------------------

const mezcla = [...masTarde, linea('B', 10, 3)]
const res2 = await cargar(mezcla)
check(res2.camiones === 1, 'el camión nuevo entra aunque venga en el mismo envío que el abierto')
check((await lineasDe('B')).join(' ') === '72', 'con su línea')
const dos = await one(`select huellas_de('DESPACHO', array['A','B']) as h`)
check(dos.h.B === huella([linea('B', 10, 3)]), 'y a ése sí se le guarda la huella')
check(dos.h.A === huella(conComplemento), 'sin tocar la del que quedó fuera')
