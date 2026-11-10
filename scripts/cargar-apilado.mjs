// Carga la lista de apilado en piso: cuantos pallets de un producto van uno sobre otro.
//   node scripts/cargar-apilado.mjs [ruta del .xlsx]
//
// La lista manda entera. Lo que no viene en ella queda a un solo nivel, porque un producto
// que nadie probo no se apila. Por eso cada corrida empieza bajando a todos a uno.
//
// El archivo no va al repositorio: vive en datos/, que esta en .gitignore.
import { loadEnv } from './lib/env.mjs'
import { hojasDe, readXlsx } from './lib/xlsx.mjs'

const ARCHIVO = process.argv[2] ?? 'datos/almacenaje-en-piso.xlsx'
const LOTE = 100

/** Las columnas de la lista, por indice. Las dos hojas traen la misma forma. */
const COL = { sku: 0, nombre: 1, cajasPorPallet: 2, dobleNivel: 3, tercerNivel: 4 }

const env = loadEnv(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY'])

const rest = async (path, body, metodo) => {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
    method: metodo ?? (body ? 'POST' : 'GET'),
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text.slice(0, 400)}`)
  return text ? JSON.parse(text) : []
}

const limpio = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()
const entero = (v) => {
  const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}
const marcado = (v) => limpio(v) === '1' || /^(true|si|x)$/i.test(limpio(v))

// ----------------------------------------------------------------------------------------

// Las hojas separan familias —abarrote y snack— y repiten la cabecera en cada seccion, asi
// que no se cuentan filas: vale la que trae SKU y cajas por pallet.
const lista = []
for (const hoja of hojasDe(ARCHIVO)) {
  for (const fila of readXlsx(ARCHIVO, hoja)) {
    const sku = limpio(fila[COL.sku])
    const cajas = entero(fila[COL.cajasPorPallet])
    if (!sku || !cajas) continue

    lista.push({
      hoja,
      sku,
      nombre: limpio(fila[COL.nombre]),
      cajas,
      niveles: marcado(fila[COL.tercerNivel]) ? 3 : marcado(fila[COL.dobleNivel]) ? 2 : 1,
    })
  }
}

if (lista.length === 0) throw new Error(`${ARCHIVO} no trajo ninguna fila con cajas por pallet`)
console.log(`${lista.length} productos en ${ARCHIVO}`)

const productos = []
for (let i = 0; i < lista.length; i += LOTE) {
  const trozo = lista.slice(i, i + LOTE).map((l) => `"${l.sku}"`)
  productos.push(...(await rest(`product?select=id,sku&sku=in.(${trozo.join(',')})`)))
}
const idPorSku = new Map(productos.map((p) => [p.sku, p.id]))

const sinProducto = lista.filter((l) => !idPorSku.has(l.sku))
if (sinProducto.length > 0) {
  console.log(`\n${sinProducto.length} no estan en el catalogo y se quedan fuera:`)
  for (const f of sinProducto) console.log(`  ${f.sku}  ${f.nombre}  (${f.hoja})`)
}

// Todos a un nivel, y despues sube la lista. Dos pasadas, para que quitar un producto de la
// lista lo baje de verdad y no quede apilable por inercia.
await rest('pallet_config?is_default=is.true', { allows_stacking: false, max_stack: 1 }, 'PATCH')

const aplicables = lista.filter((l) => idPorSku.has(l.sku) && l.niveles > 1)
for (const niveles of [...new Set(aplicables.map((l) => l.niveles))].sort()) {
  const ids = aplicables.filter((l) => l.niveles === niveles).map((l) => idPorSku.get(l.sku))
  for (let i = 0; i < ids.length; i += LOTE) {
    await rest(
      `pallet_config?is_default=is.true&product_id=in.(${ids.slice(i, i + LOTE).join(',')})`,
      { allows_stacking: true, max_stack: niveles },
      'PATCH',
    )
  }
  console.log(`\n${ids.length} productos a ${niveles} niveles`)
}

// Las cajas por pallet de la bodega no se tocan: el maestro es el que manda ese numero y
// cambiarlo aqui dejaria dos cargas peleandose. Pero si no coinciden hay que saberlo.
const estibas = []
for (let i = 0; i < productos.length; i += LOTE) {
  const ids = productos.slice(i, i + LOTE).map((p) => p.id)
  estibas.push(
    ...(await rest(
      `pallet_config?select=product_id,cases_per_pallet&is_default=is.true&product_id=in.(${ids.join(',')})`,
    )),
  )
}
const cajasPorProducto = new Map(estibas.map((e) => [e.product_id, e.cases_per_pallet]))
const difieren = lista.filter(
  (l) => idPorSku.has(l.sku) && cajasPorProducto.get(idPorSku.get(l.sku)) !== l.cajas,
)

if (difieren.length > 0) {
  console.log(`\n${difieren.length} con distintas cajas por pallet que el maestro:`)
  for (const d of difieren) {
    console.log(
      `  ${d.sku}  ${d.nombre.slice(0, 38).padEnd(38)}  lista ${d.cajas}  maestro ${cajasPorProducto.get(idPorSku.get(d.sku))}`,
    )
  }
}

console.log(`\nlisto: ${aplicables.length} apilables, el resto a un nivel`)
