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

// Que los codigos cuadren no basta: el cuadro tiene que estar donde dice el plano. El dibujo
// numeraba los fondos del rack de corrido y en nueve de los diecinueve carriles ponia el
// frente sobre la posicion de atras, asi que el mapa pintaba de picking un fondo. Eso no lo
// agarra comparar codigos: hay que comparar metros contra `coord_x` y `coord_y`, que son los
// del plano del 12/11/2026 (migracion 0096).
const centro = new Map(
  BLOQUES.flatMap((b) => b.celdas.map((c) => [c.code, { x: c.x + c.w / 2, y: c.y + c.h / 2 }])),
)
const { rows: medidas } = await db.query(`
  select l.code, l.coord_x::float8 as x, l.coord_y::float8 as y
  from location l
  join lane la on la.id = l.lane_id
  join zone z on z.id = la.zone_id
  where z.kind in ('floor', 'rack') and l.retired_at is null and l.coord_x is not null
`)
let peor = { code: null, d: 0 }
for (const m of medidas) {
  const c = centro.get(claveDePlanta(m.code))
  if (!c) continue
  const d = Math.hypot(c.x - m.x, c.y - m.y)
  if (d > peor.d) peor = { code: m.code, d }
}
check(medidas.length === enBase.size, `el plano midio las ${enBase.size} posiciones`)
check(
  peor.d < 0.1,
  `cada cuadro se pinta donde dice el plano (el peor, ${peor.code}, a ${peor.d.toFixed(2)} m)`,
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

// El tablero no pide la planta por la vista: PostgREST corta en mil filas y la bodega tiene
// 5,581 posiciones. La pide por `planta()`, que es una sola fila (migracion 0098).
const { rows: mapa } = await db.query(`
  select jsonb_array_length(planta()->'ocupadas') as ocupadas
`)
check(Number(mapa[0].ocupadas) === 0, 'con la bodega vacia no hay ninguna posicion ocupada')

// La segmentacion: una cara de picking tiene que salir en el mapa con su codigo de posicion.
await db.query(`
  update location_area set valid_to = now()
  where valid_to is null
    and location_id = (select id from location where code = 'F1-001-11')
`)
await db.query(`
  insert into location_area (location_id, area_id, valid_from)
  select l.id, a.id, now()
  from location l cross join area a
  where l.code = 'F1-001-11' and a.code = 'PICKING'
`)
const { rows: seg } = await db.query(`
  select coalesce(planta()->'areas'->'PICKING', '[]'::jsonb) ? 'F1-001-11' as esta,
         jsonb_array_length(planta()->'no_alimento') as no_alimento
`)
check(seg[0].esta === true, 'la planta dice cual posicion es cara de picking')

const { rows: cuadros } = await db.query(`
  select jsonb_array_elements_text(planta()->'areas'->'PICKING') as code
`)
check(
  cuadros.every((c) => enPlanta.has(claveDePlanta(c.code))),
  'las posiciones que manda la planta caen en cuadros del dibujo',
)

// El area va con su nivel (migracion 0102): el isometrico dibuja una caja por nivel y la cara
// de picking de un rack es el nivel 1 del frente, no la columna entera.
await db.query(`
  update location_area set valid_to = now()
  where valid_to is null
    and location_id = (select id from location where code = 'R-ABA-L01-B01-N1-P1')
`)
await db.query(`
  insert into location_area (location_id, area_id, valid_from)
  select l.id, a.id, now()
  from location l cross join area a
  where l.code = 'R-ABA-L01-B01-N1-P1' and a.code = 'PICKING'
`)
const { rows: nivel } = await db.query(`
  select coalesce(planta()->'areas'->'PICKING', '[]'::jsonb) as caras
`)
const caras = new Set(nivel[0].caras)
check(caras.has('R-ABA-L01-B01-N1-P1'), 'la cara de un rack sale con su nivel')
check(
  !caras.has('R-ABA-L01-B01-N2-P1'),
  'el nivel 2 de esa misma columna no sale como cara de picking',
)

// Tocar un cuadro de rack trae su pila entera; tocar uno de piso, esa posicion y nada mas.
const { rows: bahia } = await db.query(`select * from que_hay_en('R-ABA-L01-B01-P1')`)
check(bahia.length === 6, `un cuadro de rack son sus 6 niveles (son ${bahia.length})`)
check(
  bahia.every((f) => f.sku === null),
  'con la bodega vacia el cuadro sale libre, no vacio de filas',
)

const { rows: suelo } = await db.query(`select * from que_hay_en('F1-001-01')`)
check(suelo.length === 1, 'un cuadro de piso es una sola posicion')
check(
  (await db.query(`select * from que_hay_en('F1')`)).rows.length === 0,
  'un bloque entero no es un cuadro: no devuelve nada',
)

await db.close()
