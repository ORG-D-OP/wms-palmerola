// Carga los documentos de ingreso desde el archivo de pallets de SAP. Es idempotente.
//   node scripts/cargar-ingresos.mjs [ruta del .xlsx] [destino]
//
// La llave es el `Pedido Traslado`: esta impreso en el Comprobante de Carga, en la misma
// hoja que la lista de productos, y cubre 352 de 352 envios despachados (ver
// EVALUACION-TRAZABILIDAD.md, §36). Se guarda sin ceros a la izquierda, que es como viene
// impreso: el archivo trae «0060211130» y el papel dice «60211130».
import { loadEnv } from './lib/env.mjs'
import { hojasDe, readXlsx } from './lib/xlsx.mjs'

const ARCHIVO = process.argv[2] ?? 'datos/pallets.xlsx'
const DESTINO = process.argv[3] ?? 'Comayagua'
const LOTE = 500

// El ZRDN trae quince hojas y hay que escoger. `Format` es la primera, la que sale por
// omision, y es la de presentacion: en 10,531 de sus 10,535 filas la primera columna no trae
// el pais sino el documento MIX, corrido un lugar. `RawData` trae lo mismo pero cuadrado —solo
// dos filas sueltas al final—, asi que es de la que hay que leer. `Header`, `Pivot` y
// `RawHeader` son adornos del reporte, y `Sub1`..`Sub10` son el andamio de los subtotales:
// Sub1 trae dos filas de totales por pais y las otras nueve estan vacias.
const HOJA = 'RawData'

const COL = {
  // En `RawData` el pais siempre es el pais. Si el archivo viniera sin esa hoja y tocara leer
  // `Format`, la primera columna trae el pais o el documento MIX, y de ahi la comprobacion de
  // dos letras mas abajo.
  pais: 0,
  documento: 1,
  planta: 2,
  pallet: 4,
  vencimiento: 5,
  lote: 6,
  cantidad: 7,
  material: 8,
  fecha: 10,
  destino: 14,
  pedido: 17,
  entrega: 18,
  salida: 19,
}

const env = loadEnv(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY'])

const rest = async (path, body, prefer) => {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text.slice(0, 400)}`)
  return text ? JSON.parse(text) : []
}

const upsert = (tabla, filas, conflicto, devolver = false) =>
  rest(
    `${tabla}?on_conflict=${conflicto}`,
    filas,
    `resolution=merge-duplicates,return=${devolver ? 'representation' : 'minimal'}`,
  )

const porLotes = async (filas, fn) => {
  const salida = []
  for (let i = 0; i < filas.length; i += LOTE) {
    salida.push(...(await fn(filas.slice(i, i + LOTE))))
    process.stdout.write(`\r  ${Math.min(i + LOTE, filas.length)}/${filas.length}`)
  }
  process.stdout.write('\r')
  return salida
}

const limpio = (v) => String(v ?? '').trim()
const sinCeros = (v) => limpio(v).replace(/^0+/, '')
const fecha = (v) => (/^\d{4}-\d{2}-\d{2}/.test(limpio(v)) ? limpio(v).slice(0, 10) : null)
const cantidad = (v) => {
  const n = Number(limpio(v).replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

// ----------------------------------------------------------------------------------------

const hojas = hojasDe(ARCHIVO)
const hoja = hojas.includes(HOJA) ? HOJA : hojas[0]
const crudas = readXlsx(ARCHIVO, hoja)
console.log(`${crudas.length - 1} filas en ${ARCHIVO}, hoja ${hoja}`)

const filas = crudas
  .slice(1)
  .map((r) => ({
    pedido: sinCeros(r[COL.pedido]),
    pallet: limpio(r[COL.pallet]),
    material: limpio(r[COL.material]),
    cantidad: cantidad(r[COL.cantidad]),
    lote: limpio(r[COL.lote]) || null,
    vencimiento: fecha(r[COL.vencimiento]),
    destino: limpio(r[COL.destino]),
    planta: limpio(r[COL.planta]) || null,
    fecha: fecha(r[COL.fecha]),
    entrega: sinCeros(r[COL.entrega]) || null,
    salida: sinCeros(r[COL.salida]) || null,
    // El MIX viene en la primera o en la segunda columna segun la fila; el pais son dos
    // letras, asi que lo que no son dos letras es el documento.
    mix: /^[A-Z]{2}$/.test(limpio(r[COL.pais]))
      ? limpio(r[COL.documento]) || null
      : limpio(r[COL.pais]) || null,
  }))
  .filter((f) => f.destino === DESTINO && f.pedido && f.pallet && f.material && f.cantidad)

console.log(`${filas.length} filas con destino ${DESTINO} y datos completos`)

// Productos ------------------------------------------------------------------------------

const skus = [...new Set(filas.map((f) => f.material))]
const encontrados = []
for (let i = 0; i < skus.length; i += 50) {
  const trozo = skus.slice(i, i + 50)
  const lista = trozo.map((s) => `"${encodeURIComponent(s)}"`).join(',')
  encontrados.push(...(await rest(`product?select=id,sku&sku=in.(${lista})`)))
}
const idPorSku = new Map(encontrados.map((p) => [p.sku, p.id]))
const faltan = skus.filter((s) => !idPorSku.has(s))
console.log(`materiales: ${idPorSku.size} de ${skus.length} estan en el maestro`)

const utiles = filas.filter((f) => idPorSku.has(f.material))

// Documentos -----------------------------------------------------------------------------

const docs = new Map()
for (const f of utiles) {
  if (!docs.has(f.pedido)) {
    docs.set(f.pedido, {
      pedido: f.pedido,
      mix: f.mix,
      entrega: f.entrega,
      goods_issue: f.salida,
      origin_plant: f.planta,
      planned_at: f.fecha,
      // Lo que ya tiene salida de mercancia salio de planta; lo demas todavia no.
      status: f.salida ? 'ARRIVED' : 'EXPECTED',
    })
  }
}

const guardados = await porLotes([...docs.values()], (lote) =>
  upsert('inbound_doc', lote, 'pedido', true),
)
const idPorPedido = new Map(guardados.map((d) => [d.pedido, d.id]))
console.log(`documentos: ${guardados.length}`)

// Pallets --------------------------------------------------------------------------------

const pallets = utiles.map((f) => ({
  doc_id: idPorPedido.get(f.pedido),
  pallet_code: f.pallet,
  product_id: idPorSku.get(f.material),
  qty_cases: f.cantidad,
  lot: f.lote,
  expiry_date: f.vencimiento,
}))

// Un mismo pallet puede repetirse dentro de un pedido si el archivo lo trae dos veces; se
// queda la primera, que es lo que hace `on_conflict`, pero hay que quitarlo del lote o
// Postgres se queja de afectar la misma fila dos veces.
const vistos = new Set()
const unicos = pallets.filter((p) => {
  const clave = `${p.doc_id}|${p.pallet_code}`
  if (vistos.has(clave)) return false
  vistos.add(clave)
  return true
})

await porLotes(unicos, (lote) => upsert('inbound_pallet', lote, 'doc_id,pallet_code'))
console.log(`pallets: ${unicos.length}${pallets.length - unicos.length ? ` (${pallets.length - unicos.length} repetidos dentro de su pedido)` : ''}`)

// Lineas ---------------------------------------------------------------------------------

const lineas = []
for (const [pedido, docId] of idPorPedido) {
  const suyas = new Map()
  for (const f of utiles.filter((x) => x.pedido === pedido)) {
    const clave = `${f.material}|${f.lote ?? ''}|${f.vencimiento ?? ''}`
    suyas.set(clave, (suyas.get(clave) ?? 0) + f.cantidad)
  }
  let n = 0
  for (const [clave, cajas] of suyas) {
    const [material, lote, venc] = clave.split('|')
    lineas.push({
      doc_id: docId,
      line_no: ++n,
      product_id: idPorSku.get(material),
      qty_cases: cajas,
      lot: lote || null,
      expiry_date: venc || null,
    })
  }
}

await porLotes(lineas, (lote) => upsert('inbound_line', lote, 'doc_id,line_no'))
console.log(`lineas: ${lineas.length}`)

if (faltan.length) {
  console.log(`\nMateriales del archivo que no estan en el maestro: ${faltan.join(', ')}`)
}
