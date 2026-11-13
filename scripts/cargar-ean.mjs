// Carga los codigos de barras que la empresa mando para los productos sin DUN-14. Es
// idempotente: se vuelve a correr cuando llega una hoja nueva y no duplica nada.
//   node scripts/cargar-ean.mjs [ruta del .xlsx] [nombre de la hoja]
//
// El archivo no va al repositorio: vive en datos/, que esta en .gitignore.
import { loadEnv } from './lib/env.mjs'
import { readXlsx } from './lib/xlsx.mjs'

const ARCHIVO = process.argv[2] ?? 'datos/codigos-ean.xlsx'
const HOJA = process.argv[3] ?? 'Codigos EAN-UPC'

/**
 * El codigo de material viene como numero y Excel lo guarda con basura de punto flotante
 * («10002.200000000001»), asi que no se puede leer como texto tal cual ni pasarlo por un
 * Number a secas. En el maestro todos los codigos numericos llevan **un decimal**, el cero
 * incluido: «10006.0». De ahi el toFixed(1).
 */
const codigoDeMaterial = (celda) => {
  const texto = String(celda ?? '').trim()
  if (!texto) return null
  const n = Number(texto)
  return Number.isFinite(n) && /^[0-9.]+$/.test(texto) ? n.toFixed(1) : texto
}

/**
 * Un codigo de barras es lo que sale del lector: digitos y nada mas. La hoja los trae con
 * guiones de separacion, que se quitan. Y hay filas donde en la columna del codigo pusieron
 * el codigo de material («8-1537-20056.9»): esas no son un codigo de barras y se rechazan,
 * porque un codigo que el lector nunca va a producir es peor que ninguno —la pantalla diria
 * que el producto si tiene codigo y en la bodega no habria forma de escanearlo—.
 */
const SIMBOLOGIA = { 8: 'EAN8', 12: 'UPCA', 13: 'EAN13', 14: 'GTIN14' }

const codigoDeBarras = (celda) => {
  const limpio = String(celda ?? '').replace(/[\s-]/g, '')
  if (!/^[0-9]+$/.test(limpio)) return null
  return SIMBOLOGIA[limpio.length] ? limpio : null
}

const env = loadEnv(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY'])
const headers = {
  apikey: env.SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
  'Content-Type': 'application/json',
}

const api = async (path, method = 'GET', body) => {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: { ...headers, Prefer: 'return=representation' },
    body: body && JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${method} ${path}: ${json?.message ?? res.status}`)
  return json
}

const filas = readXlsx(ARCHIVO, HOJA).slice(1)
console.log(`${filas.length} filas en ${ARCHIVO} / ${HOJA}`)

const sinProducto = []
const sinCodigoValido = []
const yaEstaba = []
const puestos = []

for (const fila of filas) {
  const sku = codigoDeMaterial(fila[0])
  const descripcion = String(fila[1] ?? '').trim()
  const codigo = codigoDeBarras(fila[2])
  if (!sku) continue

  if (!codigo) {
    sinCodigoValido.push(`${sku} ${descripcion} → «${String(fila[2] ?? '').trim()}»`)
    continue
  }

  const niveles = await api(
    `/packaging_level?select=id,product:product_id(sku)&code=eq.CASE&product.sku=eq.${encodeURIComponent(sku)}`,
  )
  const nivel = niveles.find((n) => n.product)
  if (!nivel) {
    sinProducto.push(`${sku} ${descripcion}`)
    continue
  }

  const tiene = await api(`/barcode?select=id,code&packaging_level_id=eq.${nivel.id}`)
  if (tiene.some((b) => b.code === codigo)) {
    yaEstaba.push(`${sku} ${codigo}`)
    continue
  }

  await api('/barcode', 'POST', {
    packaging_level_id: nivel.id,
    code: codigo,
    symbology: SIMBOLOGIA[codigo.length],
    // El primero que tenga el nivel manda; si ya tenia uno, este entra de alterno.
    is_primary: tiene.length === 0,
  })
  puestos.push(`${sku} ${codigo} (${SIMBOLOGIA[codigo.length]})`)
}

console.log(`\npuestos ${puestos.length}`)
for (const p of puestos) console.log(`  ok    ${p}`)
if (yaEstaba.length) {
  console.log(`\nya estaban ${yaEstaba.length}`)
  for (const y of yaEstaba) console.log(`  =     ${y}`)
}
if (sinProducto.length) {
  console.log(`\nsin producto en el maestro ${sinProducto.length}`)
  for (const s of sinProducto) console.log(`  falta ${s}`)
}
if (sinCodigoValido.length) {
  console.log(`\nel codigo no es un codigo de barras ${sinCodigoValido.length}`)
  for (const s of sinCodigoValido) console.log(`  malo  ${s}`)
}
