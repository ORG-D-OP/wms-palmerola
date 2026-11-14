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

// Las nueve de la noche en la bodega, que en UTC ya es el dia siguiente. La hora va clavada:
// colgada de `now()`, los dos dias coincidian segun la hora a la que se corriera la prueba, y
// entonces esto no probaba nada.
const anclas = await one(
  `select ((current_date - 2 + interval '21 hours') at time zone reloj_de_bodega()) as cuando,
          (current_date - 2)::text as dia_bodega,
          (((current_date - 2 + interval '21 hours') at time zone reloj_de_bodega())::date)::text
            as dia_utc`,
)
check(
  anclas.dia_bodega !== anclas.dia_utc,
  'la hora de la prueba es una en la que los dos dias no son el mismo: si no, no prueba nada',
)

await one(
  `insert into task (type, status, product_id, qty_base, packaging_level_id, assigned_to,
     created_at, assigned_at, started_at, completed_at)
   values ('PICK', 'DONE', $1, 240, $2, $3,
     $4::timestamptz, $4::timestamptz,
     $4::timestamptz + interval '30 minutes',
     $4::timestamptz + interval '1 hour')`,
  [producto, caja, operario, anclas.cuando],
)

const anoche = await one(
  `select dia::text as dia, cajas, minutos from kpi_tarea where assigned_to = $1`,
  [operario],
)
check(
  anoche.dia === anclas.dia_bodega,
  'una tarea de las 21:00 de la bodega es de ese dia, no del dia que ya empezo en UTC',
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

const { id: anden } = await one(`select dock_door_id as id from anden_de_carga order by anden limit 1`)

/**
 * Completo es que ninguna linea salio por debajo de lo que pedia, y eso es un dato. Se medi­a
 * con `ship_note is null` —«el campo de la razon solo se llena al cerrar un camion corto»—, y
 * ese campo significaba dos cosas a la vez: se contamino por los dos lados. Al primero se le
 * deja una nota a proposito: con la regla vieja contaba corto habiendo salido con todo.
 */
for (const [code, nota, chequeadas] of [
  ['KPI-CAM-1', 'Lo llamo el cliente para avisar que iba tarde', 240],
  ['KPI-CAM-2', null, 168],
]) {
  const { id } = await one(
    `insert into sales_order (code, dock_door_id, status, shipped_at, ship_note)
     values ($1, $2, 'SHIPPED', now() - interval '1 hour', $3) returning id`,
    [code, anden, nota],
  )
  await one(
    `insert into order_line (order_id, line_no, product_id, packaging_level_id, qty_base,
       checked_qty_base, checked_at, checked_by)
     values ($1, 1, $2, $3, 240, $4, now() - interval '1 hour', $5)`,
    [id, producto, caja, chequeadas, jefe],
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
const conNota = await one(
  `select camion_completo(id) as completo from sales_order where code = 'KPI-CAM-1'`,
)
check(
  conNota.completo === true,
  'una nota en la hoja no vuelve corto un camion que salio con todo: la precision no la mira',
)
const sinNota = await one(
  `select camion_completo(id) as completo from sales_order where code = 'KPI-CAM-2'`,
)
check(
  sinNota.completo === false,
  'y el que salio corto cuenta corto aunque nadie escribiera la razon',
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

// --- el tope es solo para el turno abierto -------------------------------------------------

// Al cerrado se le cuentan sus horas, las de mas incluidas, porque lo cerro la persona o lo
// calculo el sistema a su ultima senal de vida (0071). Recortarlo en el tope seria quitarle en
// silencio las horas de mas a quien se quedo.
const { id: deMas } = await one(
  `insert into auth.users (email) values ('demas@ejemplo.test') returning id`,
)
await db.query(
  `update profile set is_active = true, approved_at = now(), role = 'auxiliar',
     full_name = 'El que se quedo' where id = '${deMas}'`,
)
await one(
  `insert into shift_assignment (profile_id, started_at, ended_at)
   values ($1, now() - interval '14 hours', now() - interval '20 minutes')`,
  [deMas],
)
const horasDeMas = await one(
  `select round(sum(horas), 1) as horas from kpi_turno_dia where profile_id = $1`,
  [deMas],
)
check(
  Math.abs(Number(horasDeMas.horas) - 13.67) < 0.2,
  'a un turno cerrado de 14 horas se le cuentan las horas de mas, no se recorta en el tope',
)

// --- el que trabaja el anden no sale improductivo ------------------------------------------

/**
 * Chequear una linea no crea tarea, y el pallet que se recibe crea una de **guardar**, que es
 * de otro. Asi que el chequeador salia con cero tareas y el turno entero improductivo, justo
 * por hacer bien lo suyo. Su trabajo si queda registrado —la linea guarda quien la chequeo y el
 * movimiento de recibo guarda quien lo recibio—, asi que se cuenta como lo que es.
 */
const { id: revisor } = await one(
  `insert into auth.users (email) values ('chequeador-kpi@ejemplo.test') returning id`,
)
await db.query(
  `update profile set is_active = true, approved_at = now(), role = 'chequeador',
     full_name = 'El del anden' where id = '${revisor}'`,
)
await one(
  `insert into shift_assignment (profile_id, started_at, ended_at)
   values ($1, now() - interval '8 hours', now() - interval '10 minutes')`,
  [revisor],
)
await db.query(
  `update order_line set checked_by = $1 where order_id in (
     select id from sales_order where code in ('KPI-CAM-1', 'KPI-CAM-2')
   )`,
  [revisor],
)
await como(revisor)
const { id: posRecibo } = await one(`select id from location where code = 'F1-004-01'`)
for (const matricula of ['PAL-KPI-1', 'PAL-KPI-2']) {
  const { id: lpn } = await one(
    `insert into lpn (code, level, source) values ($1, 'PALLET', 'NEST') returning id`,
    [matricula],
  )
  await one(
    `select post_movement('RECEIPT'::movement_type, $1::uuid, 240::numeric, null, $2::uuid, $3::uuid)`,
    [producto, posRecibo, lpn],
  )
}

await como(jefe)
const delAnden = (await db.query(`select * from kpi_por_persona()`)).rows.find(
  (r) => r.profile_id === revisor,
)
check(
  Number(delAnden.lineas_chequeadas) === 2 && Number(delAnden.pallets_recibidos) === 2,
  'lo que chequea y lo que recibe se cuentan: quedan con su nombre y su hora',
)
check(Number(delAnden.tareas) === 0, 'y no tiene ni una tarea, porque no le caen')
check(
  delAnden.improductivo_pct === null,
  'asi que no se le pone porcentaje de improductivo: seria una cifra inventada',
)
check(
  Number(delAnden.horas_turno) > 7,
  'sus horas de turno si se cuentan, que estuvo ahi las ocho',
)

const conLasDos = (await db.query(`select * from kpi_por_persona()`)).rows.find(
  (r) => r.profile_id === jefe,
)
check(
  conLasDos.improductivo_pct !== null,
  'a quien hizo tareas y chequeo lineas si se le mide el improductivo',
)

await db.close()
