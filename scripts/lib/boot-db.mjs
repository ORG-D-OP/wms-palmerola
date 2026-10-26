import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'supabase/migrations'

/** Postgres en memoria con las migraciones aplicadas. Simula lo que Supabase ya trae. */
export async function bootDb({ log = false } = {}) {
  const db = await new PGlite()

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
    create role service_role;
  `)

  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await db.exec(readFileSync(join(DIR, file), 'utf8'))
      if (log) console.log(`ok    ${file}`)
    } catch (error) {
      console.error(`falla ${file}\n  ${error.message}`)
      process.exit(1)
    }
  }

  return db
}

export function check(condition, message) {
  if (condition) {
    console.log(`ok    ${message}`)
    return
  }
  console.error(`falla ${message}`)
  process.exitCode = 1
}
