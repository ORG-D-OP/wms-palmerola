import { bootDb, check } from './lib/boot-db.mjs'

/**
 * Los numeros de los gerentes. Lo que aqui se fija: que el dia sea el de la bodega y no el del
 * servidor, que las cajas salgan del empaque y no de las unidades, que un turno que nadie cerro
 * no le regale horas al dia, que la precision cuente los camiones completos, y que los numeros
 * de cada persona no los vea cualquiera.
 */
const db = await bootDb()
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const falla = async (sql, params) =>
  db.query(sql, params).then(
    () => null,
    (e) => e.message,
  )

const { id: jefe } = await one(
  `insert into auth.users (email) values ('jefe-kpi@ejemplo.test') returning id`,
)
const { id: operario } = await one(
  `insert into auth.users (email) values ('monta-kpi@ejemplo.test') returning id`,
)
await db.query(
  `update profile set is_active = true, approved_at = now(), role = 'supervisor',
     full_name = 'Jefa de bodega' where id = '${jefe}'`,
)
await db.query(
  `update profile set is_active = true, approved_at = now(), role = 'montacargista',
     full_name = 'Montacarguista uno' where id = '${operario}'`,
)
const como = (id) => db.query(`select set_config('request.jwt.claim.sub', '${id}', false)`)

await como(jefe)

// --- el reloj de la bodega ----------------------------------------------------------------

const reloj = await one(
  `select reloj_de_bodega() as zona, tope_de_turno() = interval '12 hours' as doce`,
)
check(reloj.zona === 'America/Tegucigalpa', 'el dia se cuenta con el reloj de la bodega')
check(reloj.doce === true, 'y un turno sin cerrar cuenta hasta el tope, que es un dato del sitio')

// --- una tarea terminada vale cajas, no unidades -------------------------------------------

const { id: producto } = await one(
  `insert into product (sku, name, base_uom) values ('KPI-1', 'Jugo de prueba', 'ST') returning id`,
)
const { id: caja } = await one(
  `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 24)
   returning id`,
  [producto],
)

// A las 03:00 UTC en la bodega son las 21:00 del dia anterior. Si el dia fuera el del
// servidor, este trabajo caeria en el dia equivocado.
await one(
  `insert into task (type, status, product_id, qty_base, packaging_level_id, assigned_to,
     created_at, assigned_at, started_at, completed_at)
   values ('PICK', 'DONE', $1, 240, $2, $3,
     date_trunc('day', now()) + interval '2 hours',
     date_trunc('day', now()) + interval '2 hours',
     date_trunc('day', now()) + interval '2 hours' + interval '30 minutes',
     date_trunc('day', now()) + interval '3 hours')`,
  [producto, caja, operario],
)

const anoche = await one(
  `select dia::text as dia, cajas, minutos from kpi_tarea where assigned_to = $1`,
  [operario],
)
const ayerUtc = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
check(
  anoche.dia === ayerUtc,
  'una tarea de las 03:00 UTC es del dia anterior en la bodega, no del dia del servidor',
)
check(Number(anoche.cajas) === 10, 'las 240 unidades son 10 cajas, que es lo que se mide')
check(Number(anoche.minutos) === 60, 'y el tiempo se cuenta desde que la tarea cayo en sus manos')

// --- el turno que nadie cerro --------------------------------------------------------------

await one(
  `insert into shift_assignment (profile_id, started_at)
   values ($1, now() - interval '3 days')`,
  [operario],
)

const abierto = await db.query(
  `select dia, horas from kpi_turno_dia where profile_id = $1 order by dia`,
  [operario],
)
check(
  abierto.rows.length <= 2,
  'un turno que nadie cerro no se estira por todos los dias: se corta en el tope',
)
const horasAbierto = abierto.rows.reduce((a, r) => a + Number(r.horas), 0)
check(
  Math.abs(horasAbierto - 12) < 0.01,
  'y lo que suma son las 12 horas del tope, no las 72 que llevaba abierto',
)

// --- las cajas por hora y lo improductivo --------------------------------------------------

await one(
  `insert into shift_assignment (profile_id, started_at, ended_at)
   values ($1, now() - interval '2 hours', now() - interval '1 hour')`,
  [jefe],
)
await one(
  `insert into task (type, status, product_id, qty_base, packaging_level_id, assigned_to,
     created_at, assigned_at, started_at, completed_at)
   values ('PICK', 'DONE', $1, 1440, $2, $3,
     now() - interval '2 hours', now() - interval '2 hours',
     now() - interval '2 hours', now() - interval '90 minutes')`,
  [producto, caja, jefe],
)

const hoy = await one(
  `select cajas, horas_turno, cajas_por_hora, improductivo_pct
   from kpi_dia where dia = (now() at time zone reloj_de_bodega())::date`,
)
check(Number(hoy.cajas) === 60, 'el dia suma las cajas de sus tareas')
check(Number(hoy.horas_turno) === 1, 'y las horas de turno de su gente')
check(
  Number(hoy.cajas_por_hora) === 60,
  'las cajas por hora se miden contra la hora del turno, que es la que se paga',
)
check(
  Number(hoy.improductivo_pct) === 50,
  'y la media hora que no estuvo en una tarea sale como improductiva',
)

// --- la precision de los despachos ---------------------------------------------------------

const { id: anden } = await one(`select id from dock_door limit 1`)
for (const [code, nota] of [
  ['KPI-CAM-1', null],
  ['KPI-CAM-2', 'Faltaron 3 cajas'],
]) {
  await one(
    `insert into sales_order (code, dock_door_id, status, shipped_at, ship_note)
     values ($1, $2, 'SHIPPED', now() - interval '1 hour', $3)`,
    [code, anden, nota],
  )
}

const precision = await one(
  `select camiones, completos, precision_pct
   from kpi_dia where dia = (now() at time zone reloj_de_bodega())::date`,
)
check(Number(precision.camiones) === 2, 'los camiones del dia se cuentan')
check(
  Number(precision.completos) === 1 && Number(precision.precision_pct) === 50,
  'y el que salio corto no cuenta como completo: la precision es del 50%',
)

// --- los numeros de cada persona -----------------------------------------------------------

const gente = await db.query(`select * from kpi_por_persona()`)
check(gente.rows.length === 2, 'el desglose trae a quien trabajo o estuvo en turno')
check(
  gente.rows[0].nombre === 'Jefa de bodega' && Number(gente.rows[0].cajas) === 60,
  'ordenado por cajas, de mas a menos',
)
const montacarguista = gente.rows.find((r) => r.profile_id === operario)
check(
  Number(montacarguista.cajas) === 10 && Number(montacarguista.horas_turno) === 12,
  'y a cada quien sus cajas y sus horas',
)

// Un turno que cerro el sistema se dice, porque esas horas son un calculo: sin eso, un
// numero bajo no se distingue de un turno que nadie cerro.
await db.query(
  `update shift_assignment set auto_closed = true where profile_id = $1 and ended_at is not null`,
  [jefe],
)
const conCalculo = (await db.query(`select * from kpi_por_persona()`)).rows.find(
  (r) => r.profile_id === jefe,
)
check(
  Number(conCalculo.turnos_calculados) === 1,
  'el desglose dice cuantos de sus turnos los cerro el sistema',
)

const rangoAlReves = await falla(
  `select * from kpi_por_persona(current_date, current_date - 5)`,
)
check(rangoAlReves?.includes('al revés'), 'un rango de fechas al reves se rechaza')

await como(operario)
const ajeno = await falla(`select * from kpi_por_persona()`)
check(ajeno?.includes('jefe de bodega'), 'y los numeros de cada persona no los ve cualquiera')
