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

// La flota no hace falta para trabajar: se declara el tipo de equipo, no la unidad. Igual se
// registra una, porque el jefe la lleva y la vista tiene que seguir mostrandola.
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
await one(`select iniciar_turno('MONTACARGA_RACK', 'BOTH')`)
const conMaquina = await one(`select alcance_de($1) as alcance`, [conEquipo])
check(conMaquina.alcance === 6, 'con el montacargas de rack alcanza el nivel 6')

const tomado = await fails(`select iniciar_turno('MONTACARGA_RACK', 'BOTH')`)
check(tomado === null, 'volver a entrar cierra el turno anterior y sigue')

// La flota es el recurso escaso y no se reparte desde el sistema: lo que el sistema necesita
// saber es el alcance. Dos personas pueden declararse del mismo tipo a la vez, que es lo que
// permite que un montacarguista de rack se declare de piso cuando se acumula el trabajo de
// piso.
await como(aPie)
const mismoTipo = await fails(`select iniciar_turno('MONTACARGA_RACK', 'BOTH')`)
check(mismoTipo === null, 'dos personas pueden declarar el mismo tipo de equipo a la vez')
check(
  (await one(`select alcance_de($1) as a`, [aPie])).a === 6,
  'y las dos alcanzan el rack',
)

const inventado = await fails(`select iniciar_turno('MC-01', 'BOTH')`)
check(inventado?.includes('no existe'), 'pero el tipo tiene que existir: no es la matricula')

await one(`select cerrar_turno()`)

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
await one(`select iniciar_turno('MONTACARGA_RACK', 'OUTBOUND')`)
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
await one(`select iniciar_turno('MONTACARGA_RACK', 'BOTH')`)
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
check(
  comoEstoy.equipo === 'MONTACARGA_RACK',
  'y no se pierde el equipo declarado, que era el punto',
)

const vuelve = await one(`select * from reanudar_turno()`)
check(vuelve.paused_at === null, 'reanudar lo devuelve a la cola')

const otraVez = await one(`select * from claim_next_task(array['PUTAWAY']::task_type[])`)
check(otraVez?.id === rec.task_id, 'y la tarea le vuelve a tocar')

const nadaQueReanudar = await fails(`select reanudar_turno()`)
check(nadaQueReanudar !== null, 'reanudar sin estar pausado no hace nada callado')

const quienHay = await db.query(`select * from disponibles where id = $1`, [conEquipo])
check(quienHay.rows[0]?.disponible === true, 'el jefe puede ver quien esta en la bodega')

// --- varios roles por persona, y el rol con el que se trabaja (0053) ---------------------

/**
 * Dos casos distintos que el modelo de un rol por persona no aguantaba: el auxiliar que cubre
 * de chequeador mientras el otro esta de vacaciones, y el supervisor que baja a ayudar cuando
 * se acumula el trabajo. El primero necesita que el jefe le conceda el rol; el segundo, no.
 */

await como(aPie)
const noConcedido = await fails(`select trabajar_como('chequeador')`)
check(
  noConcedido?.includes('que te lo conceda'),
  'un auxiliar no se pone a trabajar de chequeador por su cuenta',
)

await como(jefe)
const concedido = await one(`select * from conceder_roles($1, array['chequeador']::user_role[])`, [aPie])
check(
  concedido.roles_extra.includes('chequeador'),
  'el jefe le concede el rol para cubrir las vacaciones del chequeador',
)
check(concedido.role === 'auxiliar', 'y no le toca el rango: sigue siendo auxiliar')

await como(aPie)
const ahoraSi = await one(`select has_role('chequeador') as si`)
check(ahoraSi.si === true, 'con el rol concedido pasa por chequeador')
const yLoSuyo = await one(`select has_role('auxiliar') as si`)
check(yLoSuyo.si === true, 'y sigue pasando por auxiliar: cubrir no le quita lo suyo')

await one(`select iniciar_turno(null, 'BOTH', 'chequeador')`)
const cubriendo = await one(`select rol_trabajo from mi_trabajo where profile_id = $1`, [aPie])
check(cubriendo.rol_trabajo === 'chequeador', 'entra a trabajar como chequeador')
check(
  (await one(`select role from profile where id = $1`, [aPie])).role === 'auxiliar',
  'y en la ficha sigue siendo auxiliar, que es lo que evita devolverle el rol a mano',
)

const noPuedeMontacargas = await fails(`select trabajar_como('montacargista')`)
check(
  noPuedeMontacargas?.includes('que te lo conceda'),
  'lo concedido es lo concedido: no se extiende a lo demas',
)

// El supervisor no necesita que nadie le conceda nada, y no pierde sus permisos al bajar.
await como(jefe)
const sinEntrar = await fails(`select trabajar_como('auxiliar')`)
check(sinEntrar?.includes('Primero entra a trabajar'), 'para cambiarse de rol hay que estar en turno')

await one(`select iniciar_turno()`)

// Al jefe no le caen tareas solo: por eso existe cambiarse de rol. Con el turno abierto y su
// rango puesto, la cola no le da nada.
const sinBajar = await fails(`select claim_next_task()`)
check(
  sinBajar?.includes('Con tu rango no te caen tareas solas'),
  'con su rango puesto, al jefe no le cae ninguna tarea sola',
)

await one(`select trabajar_como('auxiliar')`)
const bajo = await one(`select rol_trabajo from mi_trabajo where profile_id = $1`, [jefe])
check(bajo.rol_trabajo === 'auxiliar', 'el supervisor baja a ayudar como auxiliar')
check(
  (await one(`select has_role('supervisor') as si`)).si === true,
  'y no pierde los permisos de supervisor, que era la condicion',
)
check(
  (await one(`select role from profile where id = $1`, [jefe])).role === 'supervisor',
  'porque su rango no se movio',
)
check(
  (await one(`select manda_sobre_personal() as si`)).si === true,
  'asi que todavia manda sobre el personal mientras ayuda',
)

const yaEsta = await fails(`select trabajar_como('auxiliar')`)
check(yaEsta?.includes('Ya estás trabajando'), 'cambiarse al rol que ya tiene no hace nada')

const aMirar = await fails(`select trabajar_como('solo_lectura')`)
check(aMirar !== null, 'nadie se pone a trabajar de solo lectura: eso no es un trabajo')

// Nadie deja tareas a medias: con algo empezado no se cambia de rol.
await db.query(
  `update task set status = 'IN_PROGRESS', assigned_to = $1 where id = $2`,
  [jefe, rec.task_id],
)
const aMedias = await fails(`select trabajar_como('chequeador')`)
check(
  aMedias?.includes('empezado'),
  'con un pallet a medio camino no se cambia de rol',
)

await db.query(
  `update task set status = 'ASSIGNED', assigned_to = $1 where id = $2`,
  [jefe, rec.task_id],
)
await one(`select trabajar_como('chequeador')`)
const soltada = await one(`select status, assigned_to from task where id = $1`, [rec.task_id])
check(
  soltada.status === 'READY' && soltada.assigned_to === null,
  'y lo asignado sin empezar vuelve libre a la cola: ya no es trabajo suyo',
)

const esperando = await one(`select rol_trabajo, roles_extra from disponibles where id = $1`, [aPie])
check(
  esperando.rol_trabajo === 'chequeador',
  'el jefe ve con que rol anda cada quien, no solo cual es su rango',
)
check(esperando.roles_extra.includes('chequeador'), 'y que roles le tiene concedidos')

// El que baja a ayudar tiene que poder volver a lo suyo sin salir del turno, o la pantalla lo
// deja encerrado: los tres roles de bodega no incluyen su rango.
await one(`select trabajar_como('supervisor')`)
const devuelta = await one(`select rol_trabajo from mi_trabajo where profile_id = $1`, [jefe])
check(devuelta.rol_trabajo === 'supervisor', 'y vuelve a lo suyo sin salir del turno')
check(
  (await one(`select count(*)::int as n from shift_assignment where profile_id = $1 and ended_at is null`, [jefe])).n === 1,
  'sin abrir otro turno: es el mismo',
)

await db.close()
