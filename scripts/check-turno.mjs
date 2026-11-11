import { bootDb, check } from './lib/boot-db.mjs'

/**
 * Hay montacargas de piso y hay montacargas de rack, y son cinco contra 34 personas. El
 * turno es lo que dice con que anda cada quien y de que lado de la operacion esta, y de
 * ahi sale lo unico que importa: que a nadie le toque una tarea que no puede hacer.
 */
const db = await bootDb()
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const fails = async (sql, params) =>
  db.query(sql, params).then(
    () => null,
    (e) => e.message,
  )

const { id: jefe } = await one(
  `insert into auth.users (email) values ('jefe@ejemplo.test') returning id`,
)
const { id: conEquipo } = await one(
  `insert into auth.users (email) values ('mc@ejemplo.test') returning id`,
)
const { id: aPie } = await one(
  `insert into auth.users (email) values ('aux@ejemplo.test') returning id`,
)
await db.query(`update profile set is_active = true, approved_at = now(), role = 'supervisor' where id = '${jefe}'`)
await db.query(`update profile set is_active = true, approved_at = now(), role = 'montacargista' where id = '${conEquipo}'`)
await db.query(`update profile set is_active = true, approved_at = now(), role = 'auxiliar' where id = '${aPie}'`)
const como = (id) => db.query(`select set_config('request.jwt.claim.sub', '${id}', false)`)

const alcanceRack = await one(`select max_level from equipment_type where code = 'MONTACARGA_RACK'`)
check(
  alcanceRack.max_level === 6,
  `el montacargas de rack alcanza los 6 niveles de abarrotes (${alcanceRack.max_level})`,
)

await como(jefe)
await one(
  `insert into equipment (code, type_code) values ('MC-01', 'MONTACARGA_RACK') returning id`,
)

// ---------------------------------------------------------------------------------------
// Sin turno no hay alcance
// ---------------------------------------------------------------------------------------

await como(aPie)
const sinTurno = await one(`select alcance_de($1) as alcance, flujo_de($1) as flujo`, [aPie])
check(sinTurno.alcance === 0, 'sin turno abierto nadie alcanza mas que el piso')
check(sinTurno.flujo === 'BOTH', 'sin turno abierto le toca lo de los dos lados')

await como(conEquipo)
await one(`select iniciar_turno('MC-01', 'BOTH')`)
const conMaquina = await one(`select alcance_de($1) as alcance`, [conEquipo])
check(conMaquina.alcance === 6, 'con el montacargas de rack alcanza el nivel 6')

const tomado = await fails(`select iniciar_turno('MC-01', 'BOTH')`)
check(tomado === null, 'volver a marcar el mismo equipo cierra el turno anterior y sigue')

await como(aPie)
const ajeno = await fails(`select iniciar_turno('MC-01', 'BOTH')`)
check(ajeno?.includes('ya lo tiene otra persona'), 'dos personas no andan en el mismo montacargas')

// ---------------------------------------------------------------------------------------
// Las tareas se reparten por alcance y por flujo
// ---------------------------------------------------------------------------------------

const { id: producto } = await one(
  `insert into product (sku, name, base_uom) values ('T-1', 'Producto', 'ST') returning id`,
)
const { id: caja } = await one(
  `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 24)
   returning id`,
  [producto],
)
const { id: anden } = await one(`select id from location where code = 'STG-AND-N-01'`)

// Fuera el piso del almacen: asi la sugerencia cae en rack y la tarea pide alcance.
await como(jefe)
for (const bloque of ['F1-', 'F2-', 'F3-', 'F4-', 'F5-', 'F6-', 'F7-']) {
  await one(`select reasignar_area_por_codigo($1, 'PICKING')`, [bloque])
}

await como(aPie)
const rec = await one(`select * from receive_pallet('PAL-T1', $1, $2, 24::numeric, $3, null, null, 't-1')`, [
  producto,
  caja,
  anden,
])
const tarea = await one(`select min_level, flow from task where id = $1`, [rec.task_id])
check(tarea.min_level >= 1, `la tarea nace sabiendo a que nivel hay que subir (${tarea.min_level})`)
check(tarea.flow === 'INBOUND', 'la tarea de guardado es del lado del ingreso')

await one(`select iniciar_turno()`)
const aPieNoAlcanza = await one(`select * from claim_next_task(array['PUTAWAY']::task_type[])`)
check(
  aPieNoAlcanza?.id === undefined || aPieNoAlcanza?.id === null,
  'al que anda a pie no le toca una tarea de rack',
)

const cola = await one(`select al_alcance, de_mi_flujo from task_queue where id = $1`, [rec.task_id])
check(cola?.al_alcance === false, 'la cola explica por que no le toca: no la alcanza')

// Quien tiene el montacargas de rack si puede.
await como(conEquipo)
const mia = await one(`select * from claim_next_task(array['PUTAWAY']::task_type[])`)
check(mia?.id === rec.task_id, 'con el montacargas de rack la tarea si le toca')

// Un turno de despacho no agarra tareas de ingreso.
await one(`select cerrar_turno()`)
await one(`select iniciar_turno('MC-01', 'OUTBOUND')`)
await db.query(
  `update task set status = 'READY', assigned_to = null, assigned_at = null, started_at = null
   where id = $1`,
  [rec.task_id],
)
const deOtroLado = await one(`select * from claim_next_task(array['PUTAWAY']::task_type[])`)
check(
  deOtroLado?.id === undefined || deOtroLado?.id === null,
  'en turno de despacho no le caen las tareas de ingreso',
)
const porFlujo = await one(`select de_mi_flujo from task_queue where id = $1`, [rec.task_id])
check(porFlujo?.de_mi_flujo === false, 'la cola tambien explica el flujo')

const cerradas = await one(`select cerrar_turno() as n`)
check(cerradas.n === 1, 'cerrar turno cierra el que estaba abierto')


// --- disponible o no, sin cerrar el dia -------------------------------------------------

await como(conEquipo)
await one(`select cerrar_turno()`)
await one(`select iniciar_turno('MC-01', 'BOTH')`)
await db.query(
  `update task set status = 'READY', assigned_to = null, assigned_at = null, started_at = null
   where id = $1`,
  [rec.task_id],
)

const pausa = await one(`select * from pausar_turno('Me hablaron de la oficina')`)
check(pausa.paused_at !== null, 'marcarse no disponible no cierra el turno')
check(pausa.pause_note === 'Me hablaron de la oficina', 'y queda por que')

const enPausa = await fails(`select * from claim_next_task(array['PUTAWAY']::task_type[])`)
check(enPausa?.includes('no disponible'), 'a quien no esta disponible no le caen tareas')

const dosVeces = await fails(`select pausar_turno()`)
check(dosVeces !== null, 'no se pausa dos veces')

const comoEstoy = await one(`select paused_at, equipo from mi_trabajo where profile_id = $1`, [
  conEquipo,
])
check(comoEstoy.equipo === 'MC-01', 'y no se pierde el equipo asignado, que era el punto')

const vuelve = await one(`select * from reanudar_turno()`)
check(vuelve.paused_at === null, 'reanudar lo devuelve a la cola')

const otraVez = await one(`select * from claim_next_task(array['PUTAWAY']::task_type[])`)
check(otraVez?.id === rec.task_id, 'y la tarea le vuelve a tocar')

const nadaQueReanudar = await fails(`select reanudar_turno()`)
check(nadaQueReanudar !== null, 'reanudar sin estar pausado no hace nada callado')

const quienHay = await db.query(`select * from disponibles where id = $1`, [conEquipo])
check(quienHay.rows[0]?.disponible === true, 'el jefe puede ver quien esta en la bodega')

await db.close()
