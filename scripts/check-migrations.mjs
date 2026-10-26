import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'supabase/migrations'

// Capacidad declarada en el plano A-2. Si una migracion deja de cuadrar con esto, falla el CI.
const PLAN = { floor: 2765, rack: 2816, total: 5581 }

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

const { rows } = await db.query(`
  select
    count(*) filter (where z.kind = 'floor')::int as floor,
    count(*) filter (where z.kind = 'rack')::int as rack,
    count(*)::int as total
  from location l join lane la on la.id = l.lane_id join zone z on z.id = la.zone_id
`)

for (const [key, expected] of Object.entries(PLAN)) {
  if (rows[0][key] !== expected) {
    console.error(`${key}: se esperaban ${expected} posiciones y hay ${rows[0][key]}`)
    process.exit(1)
  }
}

console.log(`ok    ${PLAN.total} posiciones (${PLAN.floor} piso + ${PLAN.rack} rack)`)
