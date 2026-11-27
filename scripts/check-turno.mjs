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
const sinDecirCual = await fails(`select iniciar_turno()`)
check(
  sinDecirCual?.includes('Dime con qué montacargas vas'),
  'un montacarguista no entra a trabajo sin decir si va de piso o de rack',
)

await one(`select iniciar_turno('MONTACARGA_RACK', 'BOTH')`)
const conMaquina = await one(`select alcance_de($1) as alcance`, [conEquipo])
check(conMaquina.alcance === 6, 'con el montacargas de rack alcanza el nivel 6')
const desdeDonde = await one(`select nivel_minimo_de($1) as min`, [conEquipo])
check(desdeDonde.min === 1, 'y empieza en el 1: el de rack no baja al piso')

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
const { id: anden } = await one(`select location_id as id from anden_de_recibo order by anden limit 1`)

// Fuera el piso del almacen: asi la sugerencia cae en rack y la tarea pide alcance.
// Mandarlo a picking ya no lo saca —la cara es la boca del carril y lo de atras se queda en
// almacen—, asi que se saca declarando que ahi no se guarda producto.
await como(jefe)
for (const bloque of ['F1-', 'F2-', 'F3-', 'F4-', 'F5-', 'F6-', 'F7-']) {
  await one(`select reasignar_uso_por_codigo($1, 'CORRUGADO')`, [bloque])
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

// Pero el piso no, aunque llegue de sobra. El filtro era solo el techo —«si el de rack llega
// al piso, mandale piso tambien»—, asi que al montacarguista de rack le caian todas las
// tareas de piso ademas de las suyas, y la regla de la bodega es la contraria: son tareas
// distintas. La misma tarea, bajada al piso, deja de ser suya.
await db.query(
  `update task set status = 'READY', assigned_to = null, assigned_at = null, min_level = 0
   where id = $1`,
  [rec.task_id],
)
const bajada = await one(
  `select al_alcance, de_mi_equipo from task_queue where id = $1`,
  [rec.task_id],
)
check(
  bajada?.al_alcance === true && bajada?.de_mi_equipo === false,
  'la cola dice que el de rack llega al piso, pero que el piso no es trabajo suyo',
)
const nadaDePiso = await one(`select * from claim_next_task(array['PUTAWAY']::task_type[])`)
check(
  nadaDePiso?.id === undefined || nadaDePiso?.id === null,
  'y no le cae: con el montacargas de rack no se guarda en el piso',
)

// Contar es la excepcion, y a proposito: no es tarea de maquina, es de los ojos.
await db.query(`update task set type = 'COUNT' where id = $1`, [rec.task_id])
check(
  (await one(`select de_mi_equipo from task_queue where id = $1`, [rec.task_id]))
    .de_mi_equipo === true,
  'un conteo en el piso si le toca: para contar basta con llegar',
)
await db.query(`update task set type = 'PUTAWAY', min_level = 1 where id = $1`, [rec.task_id])

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

// --- de montacarguista no se trabaja «en general»: o de piso o de rack (0107) ------------
//
// Es el caso que manda el dueno de la bodega: si no llego el de rack, el supervisor le cambia
// de puesto a alguien y le da el montacargas especial. Eso pide dos cosas que no existian:
// que al escoger el rol se diga la maquina, y que la maquina se pueda cambiar sin salir del
// turno, porque salir y volver a entrar suelta el anden y el rol con el que andaba.

await como(jefe)
await one(
  `select * from conceder_roles($1, array['chequeador', 'montacargista']::user_role[])`,
  [aPie],
)

await como(aPie)
const aCual = await fails(`select trabajar_como('montacargista')`)
check(
  aCual?.includes('Dime con qué montacargas vas'),
  'cambiarse a montacarguista sin decir cual no entra: son tareas distintas',
)

await one(`select trabajar_como('montacargista', 'MONTACARGA_RACK')`)
check(
  (await one(`select rol_trabajo from mi_trabajo where profile_id = $1`, [aPie]))
    .rol_trabajo === 'montacargista',
  'con la maquina si se cambia, en un solo paso',
)
const franjaRack = await one(`select nivel_minimo_de($1) as min, alcance_de($1) as max`, [aPie])
check(
  franjaRack.min === 1 && franjaRack.max === 6,
  `y el de rack trabaja del 1 al 6, no desde el piso (${franjaRack.min}-${franjaRack.max})`,
)

await one(`select cambiar_equipo('MONTACARGA_PISO')`)
const franjaPiso = await one(`select nivel_minimo_de($1) as min, alcance_de($1) as max`, [aPie])
check(
  franjaPiso.min === 0 && franjaPiso.max === 0,
  'el jefe le cambia la maquina sin sacarlo del turno, y la franja se mueve con ella',
)
check(
  (await one(
    `select count(*)::int as n from shift_assignment
      where profile_id = $1 and ended_at is null`,
    [aPie],
  )).n === 1,
  'sin abrir otro turno: es el mismo, con su anden y su rol',
)

const yaAnda = await fails(`select cambiar_equipo('MONTACARGA_PISO')`)
check(yaAnda?.includes('Ya andas con eso'), 'cambiar a la maquina que ya trae no hace nada')

const sinNinguna = await fails(`select cambiar_equipo()`)
check(
  sinNinguna?.includes('montacarguista'),
  'y de montacarguista no se queda sin maquina: para ir a pie se cambia el rol',
)

await one(`select trabajar_como('chequeador')`)
check(
  (await one(
    `select equipment_type_code as equipo from shift_assignment
      where profile_id = $1 and ended_at is null`,
    [aPie],
  )).equipo === null,
  'quien deja de ser montacarguista entrega la maquina, o seguiria con el filtro puesto',
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

// El encierro de verdad, caminado en produccion el 14/11 con la cuenta del jefe de bodega:
// empezo un guardado trabajando de montacarguista, se salio de trabajo y volvio a entrar. Al
// volver, `iniciar_turno` no escribe rol, asi que el rol del turno es otra vez su rango, y las
// dos puertas se cierran a la vez: la cola le dice «con tu rango no te caen tareas solas» y el
// cambio de rol le dice «termina primero lo que tienes empezado». Sin salida y con un pallet
// detenido en el anden. Lo que trae en la mano se le entrega siempre, antes de preguntarle de
// que trabaja hoy.
await one(`select cerrar_turno()`)
await one(`select iniciar_turno()`)
check(
  (await one(`select rol_trabajo from mi_trabajo where profile_id = $1`, [jefe])).rol_trabajo
    === 'supervisor',
  'al volver a entrar sin escoger rol, el rol del turno es su rango otra vez',
)
const enLaMano = await one(`select id, status from claim_next_task()`)
check(
  enLaMano.id === rec.task_id && enLaMano.status === 'IN_PROGRESS',
  'y con el rango puesto la cola le devuelve lo que trae empezado en vez de encerrarlo',
)
const siguePidiendo = await fails(`select claim_next_task(array['PICK']::task_type[])`)
check(
  siguePidiendo?.includes('Con tu rango no te caen tareas solas'),
  'pero tareas nuevas siguen sin caerle: el porton del rango no se toco',
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

// --- el turno que nadie cerro se cierra solo -----------------------------------------------

// Lo que arregla: nadie cierra el turno al irse, y en la base real quedo uno de 89.9 horas.
// Mientras sigue abierto, lo que tenia asignado y no empezo es suyo y nadie mas lo puede
// tomar.

const { id: olvidadizo } = await one(
  `insert into auth.users (email) values ('olvida@ejemplo.test') returning id`,
)
await db.query(
  `update profile set is_active = true, approved_at = now(), role = 'montacargista'
    where id = '${olvidadizo}'`,
)

const { id: prod } = await one(
  `insert into product (sku, name, base_uom) values ('TRN-1', 'Jugo de turno', 'ST')
   returning id`,
)

// Entro anteayer a las seis de la manana, termino una tarea ocho horas despues y no volvio a
// dar senales. La hora va clavada y no colgada de `now()`: si el turno empezara a las nueve de
// la noche, su medianoche llegaria antes que la ultima senal y la cerraria ahi —que es lo
// correcto, pero ya no es lo que esta prueba mide—.
const entro = `((current_date - 2 + interval '6 hours') at time zone reloj_de_bodega())`
const { id: viejo } = await one(
  `insert into shift_assignment (profile_id, started_at) values ($1, ${entro}) returning id`,
  [olvidadizo],
)
await one(
  `insert into task (type, status, product_id, qty_base, assigned_to, created_at, assigned_at,
     started_at, completed_at)
   values ('PUTAWAY', 'DONE', $1, 10, $2, ${entro}, ${entro},
     ${entro} + interval '1 hour', ${entro} + interval '8 hours')`,
  [prod, olvidadizo],
)
const { id: colgada } = await one(
  `insert into task (type, status, product_id, qty_base, assigned_to, created_at, assigned_at)
   values ('PUTAWAY', 'ASSIGNED', $1, 10, $2, ${entro} + interval '2 hours',
     ${entro} + interval '2 hours') returning id`,
  [prod, olvidadizo],
)

check(
  (await one(`select cerrar_turnos_vencidos() as n`)).n === 1,
  'el turno que nadie cerro se cierra solo',
)
const cerrado = await one(
  `select auto_closed, round(extract(epoch from (ended_at - started_at)) / 3600) as horas
   from shift_assignment where id = $1`,
  [viejo],
)
check(
  Number(cerrado.horas) === 8,
  'y se cierra a la ultima senal de vida —la tarea que termino—, no a las 48 horas que llevaba',
)
check(cerrado.auto_closed === true, 'queda marcado, porque esa hora es un calculo y no un dato')
check(
  (await one(`select status, assigned_to from task where id = $1`, [colgada])).status === 'READY',
  'y lo que tenia asignado sin empezar vuelve a la cola de todos',
)

// Sin ninguna senal de vida no hay con que calcular: queda el tope de horas, que es la cota.
const { id: sinRastro } = await one(
  `insert into auth.users (email) values ('sinrastro@ejemplo.test') returning id`,
)
await db.query(
  `update profile set is_active = true, approved_at = now(), role = 'auxiliar'
    where id = '${sinRastro}'`,
)
// A las seis de la manana de anteayer, y clavado: colgado de `now()` esta prueba cambia de
// resultado segun la hora a la que se corra, porque si el turno empieza de noche su medianoche
// llega antes que el tope de 12 horas y entonces lo que manda es la medianoche.
const { id: sinTareas } = await one(
  `insert into shift_assignment (profile_id, started_at)
   values ($1, ((current_date - 2 + interval '6 hours') at time zone reloj_de_bodega()))
   returning id`,
  [sinRastro],
)
await one(`select cerrar_turnos_vencidos()`)
check(
  Number(
    (
      await one(
        `select round(extract(epoch from (ended_at - started_at)) / 3600) as horas
         from shift_assignment where id = $1`,
        [sinTareas],
      )
    ).horas,
  ) === 12,
  'y al que no dejo rastro se le cuenta el tope del sitio, no las 30 horas que estuvo abierto',
)

// Las dos guardas del tope —el que sigue trabajando y el que anda con algo en la mano—
//
// Para probarlo hace falta un turno que haya pasado el tope **pero no la medianoche de su
// dia**, y con un tope de 12 horas esa ventana depende de la hora a la que se corra esto. Asi
// que a la bodega se le pone un reloj donde ahora mismo es mediodia y un tope de una hora: la
// medianoche queda a doce horas y el tope, pasado. Se devuelven los dos despues.
await db.query(
  `update task set status = 'IN_PROGRESS', assigned_to = $2, assigned_at = now(),
     started_at = now() where id = $1`,
  [colgada, olvidadizo],
)
await db.query(
  `update site set max_flow = max_flow, max_shift_hours = 1, time_zone = (
     select case when o <= 0 then 'Etc/GMT+' || (-o)::text else 'Etc/GMT-' || o::text end
     from (select (12 - extract(hour from now() at time zone 'UTC'))::int as o) s
   )`.replace('max_flow = max_flow, ', ''),
)
await db.query(
  `update shift_assignment
     set ended_at = null, auto_closed = false, started_at = now() - interval '2 hours'
   where id = $1`,
  [viejo],
)
await one(`select cerrar_turnos_vencidos()`)
check(
  (await one(`select ended_at is null as abierto from shift_assignment where id = $1`, [viejo]))
    .abierto === true,
  'con una tarea en curso no se le cierra el turno a nadie',
)
// Y al que sigue trabajando de mas tampoco, con el mismo reloj puesto.
const { id: dePlanta } = await one(
  `insert into auth.users (email) values ('deplanta@ejemplo.test') returning id`,
)
await db.query(
  `update profile set is_active = true, approved_at = now(), role = 'chequeador'
    where id = '${dePlanta}'`,
)
const { id: dobleTurno } = await one(
  `insert into shift_assignment (profile_id, started_at)
   values ($1, now() - interval '2 hours') returning id`,
  [dePlanta],
)
await one(
  `insert into task (type, status, product_id, qty_base, assigned_to, created_at, assigned_at,
     started_at, completed_at)
   values ('PUTAWAY', 'DONE', $1, 10, $2, now() - interval '2 hours',
     now() - interval '2 hours', now() - interval '2 hours', now() - interval '10 minutes')`,
  [prod, dePlanta],
)
await one(`select cerrar_turnos_vencidos()`)
check(
  (await one(`select ended_at is null as abierto from shift_assignment where id = $1`, [dobleTurno]))
    .abierto === true,
  'al que sigue trabajando de mas no se le corta el turno',
)

await db.query(
  `update site set max_shift_hours = 12, time_zone = 'America/Tegucigalpa'`,
)

// El cierre a mano tambien suelta lo no empezado: faltaba desde la 0025.
await db.query(`update task set status = 'ASSIGNED' where id = $1`, [colgada])
await como(olvidadizo)
check((await one(`select cerrar_turno() as n`)).n === 1, 'el cierre a mano cierra su turno')
check(
  (await one(`select status from task where id = $1`, [colgada])).status === 'READY',
  'y suelta lo asignado sin empezar, que ya no es trabajo de quien se fue',
)

// --- la ultima senal de vida no se sale de su turno ----------------------------------------

// Lo que esto fija: la primera version buscaba la ultima tarea de la persona sin tope por
// arriba, asi que un turno que quedo abierto el lunes se estiraba hasta la tarea que ella hizo
// el viernes, en otro turno. Medido contra la base real: el turno de 89.9 horas se arreglo
// a 92.6, peor de como estaba.

const { id: dosTurnos } = await one(
  `insert into auth.users (email) values ('dosturnos@ejemplo.test') returning id`,
)
await db.query(
  `update profile set is_active = true, approved_at = now(), role = 'auxiliar'
    where id = '${dosTurnos}'`,
)
const { id: lunes } = await one(
  `insert into shift_assignment (profile_id, started_at, ended_at)
   values ($1, now() - interval '4 days', now() - interval '3 days') returning id`,
  [dosTurnos],
)
await one(
  `insert into task (type, status, product_id, qty_base, assigned_to, created_at, assigned_at,
     started_at, completed_at)
   values ('PUTAWAY', 'DONE', $1, 10, $2, now() - interval '4 days',
     now() - interval '4 days', now() - interval '4 days',
     now() - interval '4 days' + interval '6 hours')`,
  [prod, dosTurnos],
)
await one(
  `insert into shift_assignment (profile_id, started_at)
   values ($1, now() - interval '2 hours')`,
  [dosTurnos],
)
await one(
  `insert into task (type, status, product_id, qty_base, assigned_to, created_at, assigned_at,
     started_at, completed_at)
   values ('PUTAWAY', 'DONE', $1, 10, $2, now() - interval '2 hours',
     now() - interval '2 hours', now() - interval '2 hours', now() - interval '1 hour')`,
  [prod, dosTurnos],
)

const senal = await one(
  `select round(extract(epoch from (ultima_senal_de($1) - started_at)) / 3600) as horas
   from shift_assignment where id = $1`,
  [lunes],
)
check(
  Number(senal.horas) === 6,
  'la ultima senal de vida de un turno es la de ese turno, no la de uno posterior',
)

// --- la medianoche cierra todo -------------------------------------------------------------

// Lo pidio Jose: «por si no cierran jornada, pon que a todos se les cierra a las 12 de la
// noche». El tope de horas solo alcanza a quien entro temprano; el que entra a las dos de la
// tarde no lo pasa hasta las dos de la madrugada.

const { id: deTarde } = await one(
  `insert into auth.users (email) values ('detarde@ejemplo.test') returning id`,
)
await db.query(
  `update profile set is_active = true, approved_at = now(), role = 'auxiliar'
    where id = '${deTarde}'`,
)

// Entro ayer a media tarde —hora de la bodega— y sigue abierto. No ha pasado el tope de 12
// horas contado desde que entro... pero si paso la medianoche de su dia.
// A las tres de la tarde de **anteayer**: su medianoche llega nueve horas despues y el tope a
// las doce, asi que manda la medianoche, y las dos ya pasaron a cualquier hora del dia. Con
// `current_date - 1` esto solo valia en la media hora siguiente a la medianoche de la bodega.
const { id: ayer } = await one(
  `insert into shift_assignment (profile_id, started_at)
   values ($1, ((current_date - 2 + interval '15 hours') at time zone reloj_de_bodega()))
   returning id`,
  [deTarde],
)
// Y anda con algo en la mano, que al tope si lo frena pero a la medianoche no.
await one(
  `insert into task (type, status, product_id, qty_base, assigned_to, created_at, assigned_at,
     started_at)
   values ('PUTAWAY', 'IN_PROGRESS', $1, 10, $2, now() - interval '20 hours',
     now() - interval '20 hours', now() - interval '20 hours')`,
  [prod, deTarde],
)

await one(`select cerrar_turnos_vencidos()`)
const cortado = await one(
  `select auto_closed, ended_at = medianoche_de_su_dia(started_at) as a_medianoche
   from shift_assignment where id = $1`,
  [ayer],
)
check(
  cortado.auto_closed === true && cortado.a_medianoche === true,
  'la medianoche cierra el turno aunque la persona ande con una tarea en la mano',
)

// Y al que entro hoy no lo toca: su medianoche no ha llegado.
const { id: deHoy } = await one(
  `insert into auth.users (email) values ('dehoy@ejemplo.test') returning id`,
)
await db.query(
  `update profile set is_active = true, approved_at = now(), role = 'auxiliar'
    where id = '${deHoy}'`,
)
const { id: hoyAbierto } = await one(
  `insert into shift_assignment (profile_id, started_at) values ($1, now() - interval '5 minutes')
   returning id`,
  [deHoy],
)
await one(`select cerrar_turnos_vencidos()`)
check(
  (await one(`select ended_at is null as abierto from shift_assignment where id = $1`, [hoyAbierto]))
    .abierto === true,
  'y al que entro hoy no se le toca el turno: su medianoche no ha llegado',
)

// ---------------------------------------------------------------------------------------
// Al que no se mueve del anden no le caen viajes (0079)
// ---------------------------------------------------------------------------------------

// El chequeador ve bajar el producto, lo revisa y dice a donde va; el viaje le cae a otro. El
// sistema le estaba dando tareas de guardar y de surtir porque el reparto mira el rango y el
// alcance, y el rol del turno no lo volvia a mirar nadie.
const { id: revisor } = await one(
  `insert into auth.users (email) values ('chequeador@ejemplo.test') returning id`,
)
await db.query(
  `update profile set is_active = true, approved_at = now(), role = 'chequeador'
     where id = '${revisor}'`,
)
await como(revisor)
await one(`select iniciar_turno(null, 'BOTH')`)

const suyas = await one(
  `select cardinality(tareas_de('chequeador')) as al_chequeador,
          'PUTAWAY' = any(tareas_de('auxiliar')) as aux_guarda,
          'PICK' = any(tareas_de('montacargista')) as mc_surte`,
)
check(
  Number(suyas.al_chequeador) === 0,
  'de chequeador no le cae ninguna tarea: su trabajo es el anden, y contar es salir de ahi',
)
check(suyas.aux_guarda === true, 'al auxiliar le sigue cayendo todo')
check(suyas.mc_surte === true, 'y al montacarguista tambien')

const { id: porGuardar } = await one(
  `insert into task (type, status, product_id, qty_base, priority, min_level, flow)
   values ('PUTAWAY', 'READY', $1, 240, 900, 0, 'INBOUND') returning id`,
  [producto],
)

const noLeToca = await fails(`select * from claim_next_task(array['PUTAWAY']::task_type[])`)
check(
  noLeToca?.includes('tu trabajo es el anden') || noLeToca?.includes('tu trabajo es el andén'),
  'al chequeador no se le da la tarea de guardar, y se le dice por que',
)
check(
  (await one(`select status, assigned_to from task where id = $1`, [porGuardar])).assigned_to === null,
  'y la tarea queda libre para el que si la puede hacer',
)

const niSurtir = await fails(`select * from claim_next_task(array['PICK']::task_type[])`)
check(niSurtir !== null, 'tampoco la de surtir: el lee el tabulado y espera en el anden')

// Pedir sin decir de que tipo tampoco le trae el viaje, y se le dice por que: devolver «no hay
// nada» seria mentirle, porque hay de sobra y no es suyo.
const aCiegas = await fails(`select * from claim_next_task()`)
check(
  aCiegas?.includes('tu trabajo es el anden') || aCiegas?.includes('tu trabajo es el andén'),
  'y pidiendo trabajo a secas tampoco le cae el viaje de otro',
)

// El conteo si: eso estaba decidido, y es lo que puede hacer entre camion y camion.
const { id: porContar } = await one(
  `insert into task (type, status, product_id, qty_base, priority, min_level)
   values ('COUNT', 'READY', $1, 1, 900, 0) returning id`,
  [producto],
)
const niContar = await fails(`select * from claim_next_task(array['COUNT']::task_type[])`)
check(
  niContar !== null,
  'ni el conteo: contar es irse a una posicion de racks, y el no sale del anden',
)
check(
  (await one(`select status from task where id = $1`, [porContar])).status === 'READY',
  'y la tarea de conteo queda libre para el que si puede caminar',
)

// Y el chequeador de rango que hoy baja a ayudar de auxiliar guarda pallets como todos: lo que
// decide es el rol del turno, no el puesto. Si esto se colgara del permiso, se rompe.
await como(jefe)
await one(`select * from conceder_roles($1, array['auxiliar']::user_role[])`, [revisor])
await como(revisor)
await one(`select trabajar_como('auxiliar')`)
const bajoAAyudar = await one(`select * from claim_next_task(array['PUTAWAY']::task_type[])`)
check(
  bajoAAyudar.id === porGuardar,
  'pero si baja a ayudar de auxiliar, el mismo pallet si le cae',
)

// -----------------------------------------------------------------------------------------
// El anden lo escoge quien esta parado en el (0120)
// -----------------------------------------------------------------------------------------
//
// Antes solo lo cambiaba el jefe, y con una tareaAnden empezada dejaba pasar el cambio: la persona
// seguia fisicamente en el anden viejo y el sistema decia que estaba en otro. Ahora se mueve
// quien se mueve, y con algo en curso no se mueve nadie.

const andenes = await db.query(
  `select code from dock_door where is_active order by code limit 3`,
)
const [unAnden, otroAnden] = andenes.rows.map((r) => r.code)

await como(aPie)
await one(`select iniciar_turno()`)

const sinAnden = await one(
  `select dock_door_id from shift_assignment where profile_id = $1 and ended_at is null`,
  [aPie],
)
check(sinAnden.dock_door_id === null, 'quien entra a trabajo sin anden queda en toda la bodega')

const puesto = await one(`select * from cambiar_anden($1)`, [unAnden])
check(puesto.anden === unAnden, 'y se pone en un anden el mismo, sin pedirselo al jefe')
check(puesto.liberadas === 0, 'sin nada que soltar, suelta cero')

const mismo = await fails(`select * from cambiar_anden($1)`, [unAnden])
check(mismo?.includes('Ya andas ahi') || mismo?.includes('Ya andas ah'), 'y no se cambia al que ya tiene')

const andenInventado = await fails(`select * from cambiar_anden('AND-99')`)
check(andenInventado?.includes('ningun anden activo') || andenInventado?.includes('ningún andén activo'),
  'un anden que no existe se rechaza')

const apagado = await one(`select code from dock_door where not is_active limit 1`)
const inhabilitado = await fails(`select * from cambiar_anden($1)`, [apagado.code])
check(
  inhabilitado?.includes('activo'),
  'y un anden inhabilitado tampoco: no se puede estar donde no se trabaja',
)

// Lo asignado y sin empezar es del anden, no de la persona: al moverse, vuelve a la cola.
const { id: prodDock } = await one(
  `insert into product (sku, name, base_uom) values ('T-ANDEN-1', 'Para el anden', 'ST')
   returning id`,
)
const { id: cajaAnden } = await one(
  `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 12)
   returning id`,
  [prodDock],
)
const { id: posAnden } = await one(`select id from location where code = $1`, [
  'STG-' + unAnden,
])
const { id: destino } = await one(
  `select l.id from location l
   join location_area la on la.location_id = l.id and la.valid_to is null
   join area a on a.id = la.area_id and a.code = 'ALMACEN'
   where l.status = 'available' and l.reserved_by_task_id is null
     and not exists (select 1 from stock s where s.location_id = l.id and s.qty_base > 0)
   limit 1`,
)
const { id: tareaAnden } = await one(
  `insert into task (type, product_id, qty_base, packaging_level_id, from_location_id,
     to_location_id, priority, min_level, flow, status, assigned_to, assigned_at)
   values ('PUTAWAY', $1, 120, $2, $3, $4, 100, 0, 'INBOUND', 'ASSIGNED', $5, now())
   returning id`,
  [prodDock, cajaAnden, posAnden, destino, aPie],
)

const conSuelta = await one(`select * from cambiar_anden($1)`, [otroAnden])
check(conSuelta.anden === otroAnden, 'cambiarse de anden con una tarea asignada si se puede')
check(conSuelta.liberadas === 1, 'y la suelta: dice cuantas devolvio a la cola')

const devueltaDock = await one(
  `select status::text as estado, assigned_to from task where id = $1`,
  [tareaAnden],
)
check(
  devueltaDock.estado === 'READY' && devueltaDock.assigned_to === null,
  'la tarea vuelve libre a la cola del anden que deja, no se va con la persona',
)

// Y la guarda que faltaba: con algo empezado no se mueve nadie, ni el mismo ni el jefe.
await db.query(
  `update task set status = 'IN_PROGRESS', assigned_to = $1, assigned_at = now(),
     started_at = now() where id = $2`,
  [aPie, tareaAnden],
)

const aMediasDock = await fails(`select * from cambiar_anden($1)`, [unAnden])
check(
  aMediasDock?.includes('empezado'),
  'con una tarea empezada no se cambia de anden el mismo',
)

await como(jefe)
await one(`select iniciar_turno()`)
const niElJefe = await fails(`select * from asignar_anden($1, $2)`, [aPie, unAnden])
check(
  niElJefe?.includes('medio camino'),
  'ni el jefe lo mueve: esta fisicamente en el anden viejo con el pallet',
)

const dondeQuedo = await one(
  `select d.code from shift_assignment sa join dock_door d on d.id = sa.dock_door_id
   where sa.profile_id = $1 and sa.ended_at is null`,
  [aPie],
)
check(dondeQuedo.code === otroAnden, 'y el anden se queda como estaba: el cambio no paso')

// Terminada la tareaAnden, el cambio vuelve a estar permitido.
await db.query(`update task set status = 'DONE', completed_at = now() where id = $1`, [tareaAnden])
const yaSi = await one(`select * from asignar_anden($1, $2)`, [aPie, unAnden])
check(yaSi.anden === unAnden, 'en cuanto la termina, el jefe si lo puede mover')

// Y el auxiliar no reparte a los demas.
await como(aPie)
const ajeno = await fails(`select * from asignar_anden($1, $2)`, [jefe, otroAnden])
check(
  ajeno?.includes('jefe de bodega'),
  'repartir a los demas sigue siendo solo del jefe',
)

// La puerta de atras no existe: `poner_anden` no esta concedida, asi que nadie se salta el
// filtro de rango llamando directo al trabajo de abajo. Se comprueba el permiso y no la
// llamada, porque aqui todo corre como dueno de la base y el grant no muerde.
const conPermiso = await one(
  `select has_function_privilege('authenticated', 'poner_anden(uuid,text,boolean)', 'execute')
     as puede`,
)
check(
  conPermiso.puede === false,
  'y poner_anden no se concede: al cambio solo se entra por las dos puertas con filtro',
)

await db.close()
