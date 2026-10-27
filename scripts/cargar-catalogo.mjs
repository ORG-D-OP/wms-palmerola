// Carga el catalogo desde datos/catalogo.csv. Es idempotente: vuelve a correrse para
// refrescar sin duplicar nada.
//   node scripts/cargar-catalogo.mjs
import { loadEnv } from './lib/env.mjs'
import { readCsv } from './lib/csv.mjs'

const ARCHIVO = 'datos/catalogo.csv'
const LOTE = 500

// El maestro guarda el peso por unidad base, no por caja.
const A_GRAMOS = { G: 1, KG: 1000, MG: 0.001 }

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
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text.slice(0, 300)}`)
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

/**
 * El maestro de origen trae secuencias con doble codificación: «12´S» llega como
 * «12Â´S» porque un byte UTF-8 se guardó leído como Latin-1.
 *
 * Se reparan solo esas secuencias, no la cadena entera: muchos nombres mezclan
 * acentos correctos («PIÑA», «NÉCTAR») con la parte rota, y reconvertir todo los
 * destruiría.
 *   Â + X  (X en U+0080–U+00BF)  ->  X          porque C2 XX codifica ese caracter
 *   Ã + X  (X en U+0080–U+00BF)  ->  U+00C0+..  porque C3 XX codifica ese otro
 */
const reparar = (texto) =>
  texto
    .replace(/Â([-¿])/g, '$1')
    .replace(/Ã([-¿])/g, (_, c) =>
      String.fromCharCode(0xc0 + (c.charCodeAt(0) - 0x80)),
    )
    .replace(/[ÂÃ]+$/g, '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const num = (v) => {
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}
const entero = (v) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

const filas = readCsv(ARCHIVO)
console.log(`${filas.length} filas en ${ARCHIVO}`)

const rotos = filas.filter((f) => reparar(f.DescripcionSKU) !== f.DescripcionSKU.trim())
if (rotos.length > 0) {
  console.log(`se repararon ${rotos.length} nombres con caracteres mal codificados`)
}

const unidades = new Set((await rest('uom?select=code')).map((u) => u.code))
const sinUnidad = filas.filter((f) => !unidades.has(f.IdUnidadMedidaBase))
if (sinUnidad.length > 0) {
  const faltan = [...new Set(sinUnidad.map((f) => f.IdUnidadMedidaBase))]
  console.error(`Faltan unidades de medida en el catalogo: ${faltan.join(', ')}`)
  process.exit(1)
}

const cajas = [...new Map(
  filas.filter((f) => f.IdTipoCaja && f.DescripcionTipoCaja)
    .map((f) => [f.IdTipoCaja, { code: f.IdTipoCaja, name: reparar(f.DescripcionTipoCaja) }]),
).values()]
await upsert('box_type', cajas, 'code')
console.log(`tipos de caja: ${cajas.length}`)

const categorias = [...new Map(
  filas.filter((f) => f.IdGrupoMaterial && f.DesGrupoMaterial)
    .map((f) => [f.IdGrupoMaterial, { code: f.IdGrupoMaterial, name: reparar(f.DesGrupoMaterial) }]),
).values()]
await upsert('product_category', categorias, 'code')
const categoriaId = new Map(
  (await rest('product_category?select=id,code')).map((c) => [c.code, c.id]),
)
console.log(`categorias: ${categorias.length}`)

const productos = filas.map((f) => ({
  sku: f.IdSKU,
  name: reparar(f.DescripcionSKU),
  base_uom: f.IdUnidadMedidaBase,
  category_id: categoriaId.get(f.IdGrupoMaterial) ?? null,
  shelf_life_days: entero(f.VidaAnaquel),
  requires_fefo: f.IndFechaExpiracion !== '',
  external_barcode_hint: f.Dun14.length >= 12 ? f.Dun14 : null,
  external_source: 'maestro',
}))

console.log('productos:')
await porLotes(productos, (lote) => upsert('product', lote, 'sku'))
const productoId = new Map()
for (let offset = 0; ; offset += LOTE) {
  const pagina = await rest(`product?select=id,sku&order=sku&limit=${LOTE}&offset=${offset}`)
  for (const p of pagina) productoId.set(p.sku, p.id)
  if (pagina.length < LOTE) break
}
console.log(`productos cargados: ${productoId.size}`)

const empaques = []
const estibas = []
const pesosIncoherentes = []

for (const f of filas) {
  const id = productoId.get(f.IdSKU)
  if (!id) continue

  const factor = A_GRAMOS[f.UnidadMedidaPeso] ?? null
  const pesoUnidad = factor ? (num(f.PesoBruto) ?? 0) * factor : null
  let netoUnidad = factor ? (num(f.PesoNeto) ?? 0) * factor : null

  // El maestro trae casos con neto mayor que bruto, que es imposible. Se conserva el
  // bruto y se deja el neto vacio en vez de guardar un dato que no puede ser cierto.
  if (pesoUnidad && netoUnidad && netoUnidad > pesoUnidad) {
    pesosIncoherentes.push(f.IdSKU)
    netoUnidad = null
  }
  const porCaja = entero(f.UnidadesPorCaja)

  // PostgREST exige que todas las filas del lote tengan exactamente las mismas claves.
  const empaque = (extra) => ({
    product_id: id,
    code: 'UNIT',
    qty_base_units: 1,
    box_type_code: null,
    height_mm: null,
    width_mm: null,
    length_mm: null,
    gross_weight_g: pesoUnidad || null,
    net_weight_g: netoUnidad || null,
    is_pick_unit: false,
    is_receipt_unit: false,
    ...extra,
  })

  empaques.push(empaque({}))

  if (porCaja) {
    const mm = (v) => (entero(v) && entero(v) > 1 ? entero(v) : null)
    empaques.push(
      empaque({
        code: 'CASE',
        qty_base_units: porCaja,
        box_type_code: f.IdTipoCaja || null,
        // Las medidas del maestro vienen en milimetros.
        height_mm: mm(f.AltoTipoCaja),
        width_mm: mm(f.AnchoTipoCaja),
        length_mm: mm(f.LargoTipoCaja),
        gross_weight_g: pesoUnidad ? pesoUnidad * porCaja : null,
        net_weight_g: netoUnidad ? netoUnidad * porCaja : null,
        is_pick_unit: true,
        is_receipt_unit: true,
      }),
    )
  }

  const cajasPorPallet = entero(f.CAxPallet)
  if (cajasPorPallet && cajasPorPallet > 1) {
    estibas.push({
      product_id: id,
      pallet_type_code: 'STD',
      cases_per_pallet: cajasPorPallet,
      is_default: true,
    })
  }
}

console.log('empaques:')
await porLotes(empaques, (lote) => upsert('packaging_level', lote, 'product_id,code'))
console.log(`empaques: ${empaques.length}`)

console.log('estibas:')
await porLotes(estibas, (lote) =>
  upsert('pallet_config', lote, 'product_id,pallet_type_code'),
)
console.log(`estibas: ${estibas.length}`)

if (pesosIncoherentes.length > 0) {
  console.log(
    `
aviso: ${pesosIncoherentes.length} productos traen peso neto mayor que el bruto.` +
      ` Se cargo el bruto y se dejo el neto vacio. Ejemplos: ${pesosIncoherentes.slice(0, 5).join(', ')}`,
  )
}
