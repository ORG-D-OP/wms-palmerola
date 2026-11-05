import { bootDb, check } from './lib/boot-db.mjs'
import { BLOQUES, cajas, claveDePlanta } from '../lib/warehouse/plano.ts'

/**
 * El dibujo del plano y las posiciones de la base se escriben en dos lugares distintos: la
 * geometria sale de las cotas del plano A-2 y los codigos salen de `zone_spec`. Mientras el
 * mapa pintaba zonas enteras del mismo tono, que no cuadraran no se notaba. Ahora que pinta
 * posicion por posicion, un codigo de mas o de menos deja cuadros muertos en el mapa, asi
 * que aqui se comparan los dos: codigo por codigo, sin que sobre ni falte ninguno.
 */
const db = await bootDb()

const { rows: reales } = await db.query(`
  select l.code
  from location l
  join lane la on la.id = l.lane_id
  join zone z on z.id = la.zone_id
  where z.kind in ('floor', 'rack') and l.retired_at is null
`)

const enBase = new Set(reales.map((r) => r.code))
const delDibujo = new Set(cajas().flatMap((g) => g.cajas.map((c) => c.code)))

check(enBase.size === 5581, `la base tiene las 5,581 posiciones (tiene ${enBase.size})`)
check(
  delDibujo.size === enBase.size,
  `el dibujo tiene tantas posiciones como la base (${delDibujo.size} contra ${enBase.size})`,
)

const faltan = [...enBase].filter((c) => !delDibujo.has(c))
const sobran = [...delDibujo].filter((c) => !enBase.has(c))

check(
  faltan.length === 0,
  `el dibujo no deja posiciones sin cuadro${faltan.length ? `: ${faltan.slice(0, 4).join(', ')}` : ''}`,
)
check(
  sobran.length === 0,
  `el dibujo no inventa posiciones${sobran.length ? `: ${sobran.slice(0, 4).join(', ')}` : ''}`,
)

// Un cuadro de la planta es una posicion de piso o una pila de niveles de rack.
const enPlanta = new Set(BLOQUES.flatMap((b) => b.celdas.map((c) => c.code)))
check(
  [...enBase].every((c) => enPlanta.has(claveDePlanta(c))),
  'toda posicion de la base cae en un cuadro de la planta',
)

const { rows: pila } = await db.query(`
  select count(*)::int as n from location l
  join lane la on la.id = l.lane_id
  join zone z on z.id = la.zone_id
  where z.code = 'R-ABA' and l.code like 'R-ABA-L01-B01-%-P1'
`)
check(pila[0].n === 6, 'la pila de una bahia de abarrotes son sus 6 niveles')

const { rows: estado } = await db.query(`select count(*)::int as n from posicion_estado`)
check(estado[0].n === 0, 'con la bodega vacia el mapa no pinta nada distinto')

await db.close()
