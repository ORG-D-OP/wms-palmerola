import { bootDb, check } from './lib/boot-db.mjs'

// Capacidad declarada en el plano A-2. Si una migracion deja de cuadrar, falla el CI.
const PLAN = { floor: 2765, rack: 2816, total: 5581 }

const db = await bootDb({ log: true })

const { rows } = await db.query(`
  select
    count(*) filter (where z.kind = 'floor')::int as floor,
    count(*) filter (where z.kind = 'rack')::int as rack,
    count(*)::int as total
  from location l join lane la on la.id = l.lane_id join zone z on z.id = la.zone_id
`)

for (const [key, expected] of Object.entries(PLAN)) {
  check(rows[0][key] === expected, `${key}: ${expected} posiciones (hay ${rows[0][key]})`)
}
