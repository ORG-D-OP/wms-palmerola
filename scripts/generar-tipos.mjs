// Regenera lib/database.types.ts desde el esquema real, por la API de gestion.
// `supabase gen types` necesita el puerto de Postgres, que la red de la empresa no deja
// pasar; esto va por HTTPS 443 igual que db-apply.
//   node scripts/generar-tipos.mjs
import { writeFileSync } from 'node:fs'
import { loadEnv } from './lib/env.mjs'

const DESTINO = 'lib/database.types.ts'
const env = loadEnv(['SUPABASE_PROJECT_REF', 'SUPABASE_ACCESS_TOKEN'])

const res = await fetch(
  `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/types/typescript?included_schemas=public`,
  { headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` } },
)
if (!res.ok) {
  console.error(`${res.status} ${(await res.text()).slice(0, 400)}`)
  process.exit(1)
}

const { types } = await res.json()
if (!types || types.length < 500) {
  console.error('La respuesta no trae tipos utiles')
  process.exit(1)
}

writeFileSync(DESTINO, types.replace(/\r\n/g, '\n'), 'utf8')
console.log(`${DESTINO}: ${types.length.toLocaleString('es-HN')} caracteres`)
