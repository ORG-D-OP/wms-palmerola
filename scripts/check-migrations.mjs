import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'supabase/migrations'
const EXPECTED_FLOOR_POSITIONS = 2765

const db = await new PGlite()

// Supabase provee estos objetos; PGlite no. Se simulan para poder correr las migraciones.
await db.exec(`
  create schema if not exists auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb
  );
  create function auth.uid() returns uuid language sql stable as $fn$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $fn$;
  create role authenticated;
`)

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
  try {
    await db.exec(readFileSync(join(DIR, file), 'utf8'))
    console.log(`ok    ${file}`)
  } catch (error) {
    console.error(`falla ${file}\n  ${error.message}`)
    process.exit(1)
  }
}

const { rows } = await db.query('select count(*)::int as total from location')
const total = rows[0].total

if (total !== EXPECTED_FLOOR_POSITIONS) {
  console.error(`Se esperaban ${EXPECTED_FLOOR_POSITIONS} posiciones y hay ${total}`)
  process.exit(1)
}

console.log(`ok    ${total} posiciones sembradas`)
