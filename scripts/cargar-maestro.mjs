// Carga el maestro de materiales de la bodega. Es idempotente: se vuelve a correr cuando
// llega un maestro nuevo y refresca sin duplicar nada.
//   node scripts/cargar-maestro.mjs [ruta del .xlsx] [nombre de la hoja]
//
// El archivo no va al repositorio: vive en datos/, que esta en .gitignore.
import { loadEnv } from './lib/env.mjs'
import { readXlsx } from './lib/xlsx.mjs'

const ARCHIVO = process.argv[2] ?? 'datos/maestro.xlsx'
const HOJA = process.argv[3] ?? 'Hoja1'
const LOTE = 500
const ORIGEN = 'Maestro de materiales WMS'

/**
 * Las columnas del maestro, por indice. Los rotulos de unidad del archivo estan corridos y
 * no se pueden creer: la columna de peso dice «G» y los valores van de 1.09 a 30.08, que
 * son kilogramos (una caja de 12 litros pesa 12.02). Las medidas si son milimetros.
 */
const COL = {
  material: 0,
  nombre: 1,
  sector: 5,
  grupoExterno: 9,
  tipoCaja: 18,
  tipoEmbalaje: 20,
  dun14: 21,
  vidaAnaquel: 22,
  pesoBrutoKg: 24,
  altoMm: 26,
  anchoMm: 28,
  largoMm: 30,
  cajasPorPallet: 32,
}

/** El sector define con que no se puede mezclar un producto en el mismo carril. */
const CONTAMINACION = {
  Bebidas: 'ALIMENTO',
  Snack: 'ALIMENTO',
  Savoury: 'ALIMENTO',
  'Grasas y Aceites': 'ALIMENTO',
  'Cuidado Del Hogar': 'QUIMICO',
  Ambientales: 'AROMATICO',
  'Cuidado Personal': 'NO_ALIMENTO',
}

const FORMA = { Caja: 'CAJA', Charola: 'CHAROLA', Fardo: 'FARDO' }

const env = loadEnv(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY'])

const rest = async (path, body, prefer, metodo) => {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
    method: metodo ?? (body ? 'POST' : 'GET'),
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

const limpio = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()
const entero = (v) => {
  const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}
const numero = (v) => {
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Codigo estable y corto para un catalogo que en el maestro viene como texto libre. */
const slug = (texto) =>
  limpio(texto)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 24)

/**
 * Cuantas unidades vendibles trae la caja. Viene al final del nombre: «12s», «240s»,
 * «30´s», «20's» y alguna sin la s. Es el unico lugar del maestro donde esta, y cuadra con
 * el peso bruto: 12 x 1 L pesa 12.02 kg.
 */
const unidadesPorCaja = (nombre) => entero(limpio(nombre).match(/(\d+)\s*(?:[´'’]?s)?$/i)?.[1])

/** El DUN-14 llega de dos formas: 14 digitos seguidos o con guiones. Solo cuentan digitos. */
const dun = (v) => {
  const d = String(v ?? '').replace(/\D/g, '')
  return d.length === 14 ? d : null
}

const esOferta = (nombre, tipoCaja) =>
  /oferta|holiday|promo|weekly\s*pack/i.test(`${nombre} ${tipoCaja}`)

// ----------------------------------------------------------------------------------------

const crudas = readXlsx(ARCHIVO, HOJA)
const filas = crudas
  .slice(1)
  .map((r) => ({
    sku: limpio(r[COL.material]),
    nombre: limpio(r[COL.nombre]),
    sector: limpio(r[COL.sector]),
    grupo: limpio(r[COL.grupoExterno]),
    tipoCaja: limpio(r[COL.tipoCaja]),
    embalaje: limpio(r[COL.tipoEmbalaje]),
    dun: dun(r[COL.dun14]),
    dunCrudo: limpio(r[COL.dun14]),
    vida: entero(r[COL.vidaAnaquel]),
    pesoKg: numero(r[COL.pesoBrutoKg]),
    alto: entero(r[COL.altoMm]),
    ancho: entero(r[COL.anchoMm]),
    largo: entero(r[COL.largoMm]),
    cajasPallet: entero(r[COL.cajasPorPallet]),
  }))
  .filter((f) => f.sku)

console.log(`${filas.length} materiales en ${ARCHIVO} (hoja ${HOJA})`)

const sinUnidades = []
for (const f of filas) {
  f.unidades = unidadesPorCaja(f.nombre)
  if (!f.unidades) {
    f.unidades = 1
    sinUnidades.push(f.sku)
  }
  f.base = f.sku.slice(0, 5)
  f.variante = f.sku.slice(5) || null
}

// Catalogos --------------------------------------------------------------------------------

const cajas = [...new Set(filas.map((f) => f.tipoCaja).filter(Boolean))]
await upsert(
  'box_type',
  cajas.map((nombre) => ({
    code: slug(nombre),
    name: nombre,
    is_returnable: /retorno|plastico/i.test(nombre),
  })),
  'code',
)
console.log(`corrugados: ${cajas.length}`)

const sectores = [...new Set(filas.map((f) => f.sector).filter(Boolean))]
const grupos = [...new Set(filas.map((f) => `${f.sector}|${f.grupo}`).filter((g) => !g.endsWith('|')))]

const padres = await upsert(
  'product_category',
  sectores.map((s) => ({ code: slug(s), name: s })),
  'code',
  true,
)
const porCodigo = new Map(padres.map((c) => [c.code, c.id]))

const hijos = await upsert(
  'product_category',
  grupos.map((g) => {
    const [sector, grupo] = g.split('|')
    return {
      code: `${slug(sector)}-${slug(grupo)}`,
      name: grupo,
      parent_id: porCodigo.get(slug(sector)) ?? null,
    }
  }),
  'code',
  true,
)
for (const c of hijos) porCodigo.set(c.code, c.id)
console.log(`categorias: ${sectores.length} sectores, ${grupos.length} grupos`)

// Productos --------------------------------------------------------------------------------

const categoriaDe = (f) => {
  const hijo = `${slug(f.sector)}-${slug(f.grupo)}`
  return porCodigo.get(hijo) ?? porCodigo.get(slug(f.sector)) ?? null
}

const productos = await porLotes(filas, (lote) =>
  upsert(
    'product',
    lote.map((f) => ({
      sku: f.sku,
      base_code: f.base,
      variant: f.variante,
      name: f.nombre,
      sector: f.sector || null,
      units_label: limpio(f.nombre).match(/(\d+\s*[´'’]?s)$/i)?.[1] ?? null,
      category_id: categoriaDe(f),
      base_uom: 'ST',
      status: 'active',
      contamination_class: CONTAMINACION[f.sector] ?? null,
      requires_fefo: true,
      shelf_life_days: f.vida,
      type_code: esOferta(f.nombre, f.tipoCaja) ? 'OFERTA' : 'NORMAL',
      packaging_form_code: FORMA[f.embalaje] ?? null,
      external_source: ORIGEN,
      external_barcode_hint: f.dun ? null : f.dunCrudo || null,
    })),
    'sku',
    true,
  ),
)
const idPorSku = new Map(productos.map((p) => [p.sku, p.id]))
console.log(`productos: ${productos.length}`)

// Empaques ---------------------------------------------------------------------------------

const niveles = []
for (const f of filas) {
  const id = idPorSku.get(f.sku)
  if (!id) continue
  // PostgREST exige que todas las filas de un insert masivo tengan las mismas claves.
  niveles.push({
    product_id: id,
    code: 'UNIT',
    qty_base_units: 1,
    box_type_code: null,
    length_mm: null,
    width_mm: null,
    height_mm: null,
    gross_weight_g: null,
    is_pick_unit: true,
    is_receipt_unit: false,
    is_sellable: true,
  })
  niveles.push({
    product_id: id,
    code: 'CASE',
    qty_base_units: f.unidades,
    box_type_code: f.tipoCaja ? slug(f.tipoCaja) : null,
    length_mm: f.largo,
    width_mm: f.ancho,
    height_mm: f.alto,
    // El maestro rotula el peso como gramos y trae kilogramos.
    gross_weight_g: f.pesoKg ? Math.round(f.pesoKg * 1000) : null,
    is_pick_unit: false,
    is_receipt_unit: true,
    is_sellable: true,
  })
}

const empaques = await porLotes(niveles, (lote) =>
  upsert('packaging_level', lote, 'product_id,code', true),
)
const nivelPorClave = new Map(empaques.map((n) => [`${n.product_id}|${n.code}`, n.id]))
console.log(`empaques: ${empaques.length}`)

// Codigos de barras ------------------------------------------------------------------------

const codigos = []
for (const f of filas) {
  const id = idPorSku.get(f.sku)
  const nivel = nivelPorClave.get(`${id}|CASE`)
  if (!id || !nivel || !f.dun) continue
  codigos.push({
    packaging_level_id: nivel,
    code: f.dun,
    symbology: 'GTIN14',
    is_primary: true,
  })
}
await porLotes(codigos, (lote) => upsert('barcode', lote, 'packaging_level_id,code'))
console.log(`codigos DUN-14: ${codigos.length}`)

// Estiba -----------------------------------------------------------------------------------

const estibas = []
for (const f of filas) {
  const id = idPorSku.get(f.sku)
  if (!id || !f.cajasPallet) continue
  estibas.push({
    product_id: id,
    pallet_type_code: 'STD',
    cases_per_pallet: f.cajasPallet,
    total_weight_kg: f.pesoKg ? Number((f.pesoKg * f.cajasPallet).toFixed(2)) : null,
    is_default: true,
  })
}
await porLotes(estibas, (lote) => upsert('pallet_config', lote, 'product_id,pallet_type_code'))
console.log(`estibas: ${estibas.length}`)

// Lo que hay que mirar ---------------------------------------------------------------------

const sinDun = filas.filter((f) => !f.dun)
const repetidos = new Map()
for (const f of filas) {
  if (!f.dun) continue
  if (!repetidos.has(f.dun)) repetidos.set(f.dun, [])
  repetidos.get(f.dun).push(f)
}
const compartidos = [...repetidos.values()].filter((v) => v.length > 1)
const entreBases = compartidos.filter((v) => new Set(v.map((f) => f.base)).size > 1)

console.log('\nLo que queda pendiente de revisar:')
console.log(`  sin DUN-14 valido: ${sinDun.length}${sinDun.length ? ` (${sinDun.slice(0, 5).map((f) => f.sku).join(', ')}...)` : ''}`)
console.log(`  codigos compartidos entre variantes del mismo producto: ${compartidos.length - entreBases.length}`)
console.log(`  codigos compartidos entre productos DISTINTOS (conflicto real): ${entreBases.length}`)
if (sinUnidades.length) {
  console.log(`  sin unidades por caja en el nombre, quedaron en 1: ${sinUnidades.join(', ')}`)
}
