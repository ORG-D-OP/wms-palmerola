// Carga desde la consola los Excel que SAP produce. Es el mismo camino que la pantalla
// `/datos`: el archivo se lee aqui, se reconoce solo y las filas van por tandas a las
// funciones de la base. Sirve para la carga inicial, cuando son miles de filas de golpe.
//
//   node scripts/cargar-sap.mjs <archivo.xlsx> [mas archivos...]
//
// Es idempotente: subir dos veces lo mismo deja lo mismo que subirlo una.
import { basename } from 'node:path'
import { loadEnv } from './lib/env.mjs'
import { abrirArchivo } from './lib/xlsx.mjs'
import { leer } from '../lib/sap/leer.ts'
import { NOMBRE, fechaDelArchivo, tandas } from '../lib/sap/reportes.ts'

const TANDA = 2000

const archivos = process.argv.slice(2)
if (archivos.length === 0) {
  console.error('Uso: node scripts/cargar-sap.mjs <archivo.xlsx> [mas archivos...]')
  process.exit(1)
}

const env = loadEnv(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY'])

async function rpc(nombre, args) {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  const texto = await res.text()
  if (!res.ok) throw new Error(`${nombre}: ${res.status} ${texto.slice(0, 500)}`)
  return texto ? JSON.parse(texto) : null
}

// Que funcion de la base recibe cada reporte, con que nombre llegan sus filas y por que
// campo se agrupan para que un documento no se parta entre dos tandas.
const DESTINO = {
  INGRESO: { fn: 'cargar_ingresos', de: (l) => l.ingresos, clave: (f) => f.pedido },
  DESPACHO: { fn: 'cargar_despachos', de: (l) => l.despachos, clave: (f) => f.transporte },
  INVENTARIO: { fn: 'cargar_inventario_sap', de: (l) => l.inventario, clave: (f) => f.material },
  PRONOSTICO: { fn: 'cargar_pronostico', de: (l) => l.pronostico, clave: (f) => f.material },
  SALIDAS: { fn: 'cargar_salidas', de: (l) => l.salidas, clave: (f) => f.pedido },
  TRAZA: { fn: null, de: () => [], clave: () => '' },
}

const zona = await rpc('zona_del_pronostico', {})

for (const ruta of archivos) {
  const nombre = basename(ruta)
  console.log(`\n=== ${nombre}`)

  const libro = await abrirArchivo(ruta)
  const leido = await leer(libro, zona)
  if (!leido) {
    console.log('  No se reconoce: no trae las columnas de ninguno de los reportes conocidos.')
    continue
  }

  console.log(`  ${NOMBRE[leido.kind]} — ${leido.leidas} filas leídas`)
  for (const aviso of leido.avisos) console.log(`  · ${aviso}`)

  const destino = DESTINO[leido.kind]
  const filas = destino.de(leido) ?? []
  const total = {}

  if (destino.fn && filas.length > 0) {
    let hechas = 0
    for (const tanda of tandas(filas, destino.clave, TANDA)) {
      const args = { p_filas: tanda }
      if (leido.kind === 'INVENTARIO') args.p_fecha = fechaDelArchivo(nombre)
      const salida = await rpc(destino.fn, args)
      for (const [k, v] of Object.entries(salida ?? {})) total[k] = (total[k] ?? 0) + v
      hechas += tanda.length
      process.stdout.write(`\r  ${hechas}/${filas.length}`)
    }
    process.stdout.write('\r')
  }

  const detalle = { ...leido.resumen, ...total }
  await rpc('registrar_carga', {
    p_kind: leido.kind,
    p_file_name: nombre,
    p_rows_read: leido.leidas,
    p_detail: detalle,
  })
  console.log(`  guardado: ${JSON.stringify(detalle)}`)
}
