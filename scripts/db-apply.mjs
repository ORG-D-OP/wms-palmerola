// Aplica las migraciones por la API de gestion (HTTPS 443).
// `supabase db push` necesita el puerto de Postgres, que la red de la empresa no deja pasar.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv } from './lib/env.mjs'

const DIR = 'supabase/migrations'
const FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/

const env = loadEnv(['SUPABASE_PROJECT_REF', 'SUPABASE_ACCESS_TOKEN'])

async function run(query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    },
  )
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 500)}`)
  return text ? JSON.parse(text) : null
}

await run(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key, name text, statements text[]
  );
`)

const applied = new Set(
  (await run('select version from supabase_migrations.schema_migrations')).map((r) => r.version),
)

for (const file of readdirSync(DIR).sort()) {
  const match = file.match(FILE_PATTERN)
  if (!match) {
    console.error(`Nombre de migracion invalido: ${file}`)
    process.exit(1)
  }

  const version = match[1]
  if (applied.has(version)) {
    console.log(`ya aplicada  ${file}`)
    continue
  }

  await run(readFileSync(join(DIR, file), 'utf8'))
  await run(
    `insert into supabase_migrations.schema_migrations (version, name)
     values ('${version}', '${file}')`,
  )
  console.log(`aplicada     ${file}`)
}
