import { bootDb, check } from './lib/boot-db.mjs'
import { leer } from '../lib/sap/leer.ts'

/**
 * El ZMB51. SAP lo exporta con dos juegos de rotulos para las mismas columnas, y la
 * correspondencia no es la obvia: con los rotulos cortos «Ce.» es la planta que despacha y
 * «Centro» la que recibe, mientras que con los largos «Centro» es la que despacha y la que
 * recibe se llama «Centro receptor». Leyendo mal esas dos columnas el lector dejaba el centro
 * receptor vacio y la fecha en nulo, y `cargar_salidas`, que filtra por centro receptor,
 * descartaba el archivo entero sin decir nada: 793 lineas buenas, cero documentos.
 *
 * Lo que aqui se fija: que las dos cabeceras se lean igual de bien, que lo que no viene para
 * Palmerola no entre, y que un extracto sin movimientos 641 avise en vez de callarse.
 */

const CORTA = [
  'Material', 'Texto breve de material', 'Ce.', 'Alm.', 'Doc.mat.', 'CMv',
  'Texto de clase-mov.', 'Lote', 'Pedido', 'D/H', 'Centro', 'Fe.contab.', 'Ctd.en UM entrada',
]
const LARGA = [
  'Material', 'Texto breve de material', 'Ctd.en UM entrada', 'Centro', 'Almacén',
  'Clase de movimiento', 'Documento material', 'Fe.contabilización', 'Lote',
  'Centro receptor', 'Texto de clase-mov.', 'Pedido',
]

/** Un libro de mentira: `leer` solo pide hojas y filas, no le hace falta un xlsx. */
const libroDe = (cabecera, filas) => ({
  hojas: ['Hoja1'],
  async filas() {
    return [cabecera, ...filas.map((f) => cabecera.map((c) => String(f[c] ?? '')))]
  },
})

/**
 * Una linea de 641 que sale de la planta 3001 hacia Palmerola. `despacha` y `recibe` se
 * reparten distinto segun la cabecera, que es justo lo que se esta comprobando: en la corta
 * «Ce.» despacha y «Centro» recibe; en la larga «Centro» despacha y «Centro receptor» recibe.
 */
const linea = ({ despacha = '3001', recibe = '1003', ...over } = {}) => ({
  Material: '61244.4',
  'Ctd.en UM entrada': '-120',
  CMv: '641',
  'Clase de movimiento': '641',
  'Doc.mat.': '4947219291',
  'Documento material': '4947219291',
  Pedido: '0060214281',
  'Ce.': despacha,
  Centro: recibe,
  'Centro receptor': recibe,
  'Fe.contab.': '46335',
  'Fe.contabilización': '2026-11-09',
  ...over,
})

const salidasDe = async (cabecera, filas) =>
  leer(libroDe(cabecera, filas), 'America/Tegucigalpa')

// --- las dos cabeceras dan lo mismo ------------------------------------------------------

for (const [nombre, cabecera, centro] of [
  ['corta', CORTA, 'Centro'],
  ['larga', LARGA, 'Centro receptor'],
]) {
  const larga = cabecera === LARGA
  const fila = (over = {}) => {
    const l = linea(over)
    return larga ? { ...l, Centro: l['Ce.'] } : l
  }
  const leido = await salidasDe(cabecera, [fila()])
  const s = leido.salidas?.[0]
  check(leido.kind === 'SALIDAS', `cabecera ${nombre}: se reconoce como salidas de planta`)
  check(s?.pedido === '60214281', `cabecera ${nombre}: el pedido viene sin los ceros de SAP`)
  check(s?.centro === '3001', `cabecera ${nombre}: la planta que despacha es la 3001`)
  check(s?.centro_receptor === '1003', `cabecera ${nombre}: «${centro}» es quien recibe`)
  check(s?.fecha === '2026-11-09', `cabecera ${nombre}: la fecha de contabilización se entiende`)
  check(s?.cantidad === 120, `cabecera ${nombre}: la cantidad entra en positivo`)
}

// --- lo que no sirve se cuenta pero no se guarda ------------------------------------------

const mezcla = await salidasDe(CORTA, [
  linea({}),
  linea({ CMv: '303', Pedido: '' }),
  linea({ CMv: '304', Pedido: '' }),
])
check(mezcla.leidas === 3, 'se leen todas las líneas, sirvan o no')
check(mezcla.salidas?.length === 1, 'solo la 641 con pedido se guarda')
check(
  mezcla.resumen.clase_303 === 1 && mezcla.resumen.clase_304 === 1,
  'las clases que no sirven se cuentan en el resumen',
)
check(mezcla.avisos.length === 0, 'con 641 dentro no hay nada que avisar')

const sin641 = await salidasDe(CORTA, [linea({ CMv: '303', Pedido: '' })])
check(sin641.salidas?.length === 0, 'un extracto sin 641 no guarda nada')
check(
  sin641.avisos.some((a) => a.includes('641')),
  'un extracto sin 641 avisa que hay que pedirlo sin filtrar la clase de movimiento',
)

// --- y lo que llega a la base -------------------------------------------------------------

const db = await bootDb()
const one = async (sql, params) => (await db.query(sql, params)).rows[0]

await one(
  `insert into product (sku, name, base_uom, base_code, variant)
   values ('61244.4', 'Galleta 24s', 'ST', '61244', '.4')`,
)

const entraron = await salidasDe(CORTA, [
  linea({}),
  linea({ Material: '61244.4', 'Ctd.en UM entrada': '-60', 'Doc.mat.': '4947219292' }),
  // Este camión va a otro centro: no es de Palmerola y no tiene por qué aparecer aquí.
  linea({ Pedido: '0060214999', recibe: '2001', 'Doc.mat.': '4947219293' }),
])
const r = await one(`select cargar_salidas($1::jsonb) as r`, [JSON.stringify(entraron.salidas)])
check(r.r.documentos === 1, 'solo entra el pedido que viene para Palmerola')
check(r.r.lineas === 1, 'las dos líneas del mismo material se suman en una')
check(r.r.sin_producto === 0, 'el material estaba en el maestro')

const doc = await one(`select pedido, origin_plant, planned_at, status from inbound_doc`)
check(doc.pedido === '60214281', 'el documento queda con su pedido de traslado')
check(doc.origin_plant === '3001', 'y con la planta que lo despachó')
check(
  doc.planned_at?.toISOString().slice(0, 10) === '2026-11-09',
  'y con la fecha en que salió de planta',
)

const lin = await one(`select qty_cases from inbound_line`)
check(Number(lin.qty_cases) === 180, 'la línea trae las 180 cajas de las dos salidas')
