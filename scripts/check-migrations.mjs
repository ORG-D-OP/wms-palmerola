import { bootDb, check } from './lib/boot-db.mjs'

// Capacidad de almacenaje declarada en el plano A-2. Las posiciones de anden no cuentan:
// son de paso, no guardan inventario.
const PLAN = { floor: 2765, rack: 2816, almacenaje: 5581 }
const ANDENES = 29

const db = await bootDb({ log: true })

const { rows } = await db.query(`
  select
    count(*) filter (where z.kind = 'floor')::int as floor,
    count(*) filter (where z.kind = 'rack')::int as rack,
    count(*) filter (where z.kind in ('floor', 'rack'))::int as almacenaje,
    count(*) filter (where l.kind = 'staging')::int as transito
  from location l join lane la on la.id = l.lane_id join zone z on z.id = la.zone_id
`)

for (const [key, expected] of Object.entries(PLAN)) {
  check(rows[0][key] === expected, `${key}: ${expected} posiciones (hay ${rows[0][key]})`)
}

check(
  rows[0].transito === ANDENES,
  `transito: una posicion por anden (hay ${rows[0].transito})`,
)
