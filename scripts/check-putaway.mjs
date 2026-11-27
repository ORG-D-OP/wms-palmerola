import { bootDb, check } from './lib/boot-db.mjs'

const db = await bootDb()
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const fails = async (sql, params) =>
  db.query(sql, params).then(
    () => null,
    (e) => e.message,
  )

const { id: yo } = await one(`insert into auth.users (email) values ('yo@ejemplo.test') returning id`)
const { id: otro } = await one(`insert into auth.users (email) values ('otro@ejemplo.test') returning id`)
const como = (id) => db.query(`select set_config('request.jwt.claim.sub', '${id}', false)`)

// Los dos trabajan en la bodega: con el rango de solo lectura la cola no les da nada.
await db.query(
  `update profile set role = 'auxiliar' where id in ('${yo}', '${otro}')`,
)

const { id: productId } = await one(
  `insert into product (sku, name, base_uom) values ('T-1', 'Producto', 'ST') returning id`,
)
const { id: caseId } = await one(
  `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 24)
   returning id`,
  [productId],
)
const { id: anden } = await one(`select location_id as id from anden_de_recibo order by anden limit 1`)

await como(yo)
const r = await one(
  `select * from receive_pallet('PAL-9001', $1, $2, 144, $3, 'L2601', '2027-04-24', 'rec-1')`,
  [productId, caseId, anden],
)
await one(`select iniciar_turno()`)
const tarea = await one(`select * from claim_next_task(array['PUTAWAY']::task_type[])`)
check(tarea.id === r.task_id, 'el montacarguista recibe la tarea que dejo la recepcion')

const otroPallet = await fails(`select start_putaway($1, 'PAL-0000')`, [tarea.id])
check(
  otroPallet?.includes('no es el pallet de esta tarea'),
  'escanear otro pallet se detiene antes de mover nada',
)

await como(otro)
const ajena = await fails(`select start_putaway($1, $2)`, [tarea.id, r.lpn_code])
check(ajena?.includes('no es tuya'), 'no se puede ejecutar la tarea de otro')

await como(yo)
const sinEscanear = await fails(`select * from complete_putaway($1, $2)`, [
  tarea.id,
  r.to_location_code,
])
check(sinEscanear?.includes('Primero escanea el pallet'), 'no se cierra sin confirmar el pallet')

await one(`select start_putaway($1, $2)`, [tarea.id, r.lpn_code])

const inexistente = await fails(`select * from complete_putaway($1, 'NO-EXISTE')`, [tarea.id])
check(inexistente?.includes('No existe la posición'), 'una posicion inventada se rechaza')

// Un carril con otro producto no puede recibir este pallet. F2 porque la zona F1 es la del
// no alimento y ahi saltaria antes la regla del grupo.
const { id: intruso } = await one(
  `insert into product (sku, name, base_uom) values ('T-2', 'Otro', 'ST') returning id`,
)
const vecina = await one(
  `select l.code from location l
   where l.lane_id = (select lane_id from location where code = 'F2-002-01')
     and l.code <> 'F2-002-01' limit 1`,
)
await one(
  `select post_movement('RECEIPT'::movement_type, $1::uuid, 10::numeric, null,
     (select id from location where code = $2))`,
  [intruso, vecina.code],
)
const carrilOcupado = await fails(`select * from complete_putaway($1, 'F2-002-01')`, [tarea.id])
check(
  carrilOcupado?.includes('otro producto o lote'),
  'no deja guardar en un carril con otro producto',
)

// En rack el carril es la bahia, no la corrida entera: el fondo esta cerrado y la bahia de al
// lado no.
const bahia = 'R-SNK-L01-B03-N2-P1'
const elFondo = 'R-SNK-L01-B03-N2-P2'
const otraBahia = 'R-SNK-L01-B04-N2-P1'
await one(
  `select post_movement('RECEIPT'::movement_type, $1::uuid, 10::numeric, null,
     (select id from location where code = $2))`,
  [intruso, bahia],
)
const fondoCerrado = await fails(`select * from complete_putaway($1, $2)`, [tarea.id, elFondo])
check(
  fondoCerrado?.includes('frente y el fondo'),
  'el fondo de una bahia con otro producto esta cerrado',
)
const vecinaLibre = await one(
  `select suggest_putaway_location($1) is not null as hay`,
  [productId],
)
check(vecinaLibre.hay === true, 'con una bahia tomada el rack sigue teniendo sitio')
const bahiaDeAlLado = await one(
  `select count(*)::int as n from location l
   where l.code = $1 and not exists (
     select 1 from stock s join location o on o.id = s.location_id
     where o.carril = l.carril and s.qty_base > 0)`,
  [otraBahia],
)
check(bahiaDeAlLado.n === 1, 'la bahia de al lado no se contagia')

// Lo que no es alimento tiene su zona, y la zona no admite alimento.
const { id: quimico } = await one(
  `insert into product (sku, name, base_uom, contamination_class)
   values ('T-3', 'Jabon de prueba', 'ST', 'QUIMICO') returning id`,
)
const paraQuimico = await one(`select grupo from location where code = 'F1-002-01'`)
check(paraQuimico.grupo === 'NO_ALIMENTO', 'la zona F1 es la del no alimento')
const alimentoEnF1 = await fails(`select * from complete_putaway($1, 'F1-002-01')`, [tarea.id])
check(
  alimentoEnF1?.includes('sólo va lo que no es alimento'),
  'un alimento no entra en la zona del no alimento',
)
const sitioQuimico = await one(
  `select l.grupo from location l where l.id = suggest_putaway_location($1)`,
  [quimico],
)
check(sitioQuimico.grupo === 'NO_ALIMENTO', 'al quimico se le manda a su zona')

const cerrada = await one(`select * from complete_putaway($1, $2)`, [tarea.id, r.to_location_code])
check(cerrada.era_la_sugerida === true, 'cerrar en la posicion sugerida queda marcado como tal')

const saldoAnden = await one(
  `select coalesce(sum(qty_base), 0) as q from stock where location_id = $1`,
  [anden],
)
const saldoDestino = await one(
  `select coalesce(sum(qty_base), 0) as q from stock s join location l on l.id = s.location_id
   where l.code = $1`,
  [r.to_location_code],
)
check(Number(saldoAnden.q) === 0, 'el anden queda libre')
check(Number(saldoDestino.q) === 3456, 'las 144 cajas quedan en su posicion, en unidades base')

const desglosado = await one(`select * from desglose($1, $2)`, [productId, saldoDestino.q])
check(
  desglosado.cajas === 144 && Number(desglosado.sueltas) === 0,
  'el pallet guardado se lee como 144 cajas completas',
)

const tareaFinal = await one(`select * from task where id = $1`, [tarea.id])
check(tareaFinal.status === 'DONE', 'la tarea queda cerrada')

const reserva = await one(
  `select reserved_by_task_id from location where code = $1`,
  [r.to_location_code],
)
check(reserva.reserved_by_task_id === null, 'la reserva del hueco se libera')

const tiempos = await one(`select * from task_timing where id = $1`, [tarea.id])
check(
  tiempos.viaje_min !== null && tiempos.ejecucion_min !== null,
  'el ciclo deja separados el viaje y la ejecucion',
)

const reCerrar = await fails(`select * from complete_putaway($1, $2)`, [
  tarea.id,
  r.to_location_code,
])
check(reCerrar?.includes('Primero escanea el pallet'), 'una tarea cerrada no se vuelve a cerrar')

// ---------------------------------------------------------------------------------------
// Lo apartado por otro cuenta igual que lo que ya esta en el carril (0069)
// ---------------------------------------------------------------------------------------
// La regla del carril es una sola: un producto y un lote. `complete_putaway` la hacia valer
// pero el sugeridor no la miraba, asi que mandaba a dos personas al mismo carril con
// productos distintos y la segunda rebotaba al llegar.

const { id: otroProducto } = await one(
  `insert into product (sku, name, base_uom) values ('T-99', 'Otro producto', 'ST') returning id`,
)
const { id: otroCase } = await one(
  `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 12)
   returning id`,
  [otroProducto],
)

const primero = await one(
  `select * from receive_pallet('PAL-9100', $1, $2, 10, $3, 'L-A', '2027-06-30', 'rec-100')`,
  [productId, caseId, anden],
)
const segundo = await one(
  `select * from receive_pallet('PAL-9101', $1, $2, 10, $3, 'L-B', '2027-06-30', 'rec-101')`,
  [otroProducto, otroCase, anden],
)

const carriles = await one(
  `select
     (select lane_id from location where code = $1) as uno,
     (select lane_id from location where code = $2) as dos`,
  [primero.to_location_code, segundo.to_location_code],
)
check(
  segundo.to_location_code !== null && carriles.uno !== carriles.dos,
  'a dos productos distintos recibidos a la vez no se les manda al mismo carril',
)

// Y la prueba de que eso era lo que rompia: el segundo puede guardar donde le dijeron.
// El primero toma la suya —la cola da la mas vieja— y el segundo la que queda.
await one(`select * from claim_next_task(array['PUTAWAY']::task_type[])`)

await como(otro)
await one(`select iniciar_turno()`)
const suya = await one(
  `select * from claim_next_task(array['PUTAWAY']::task_type[])`,
)
check(suya.lpn_id === segundo.lpn_id, 'cada quien se lleva su pallet de la cola')
await one(`select start_putaway($1, 'PAL-9101')`, [suya.id])
const guardada = await one(`select * from complete_putaway($1, $2)`, [
  suya.id,
  segundo.to_location_code,
])
check(
  guardada.era_la_sugerida === true,
  'y al llegar no le dicen que ese carril es de otro producto',
)

// -----------------------------------------------------------------------------------------
// El anden no es un hueco (0119)
// -----------------------------------------------------------------------------------------
//
// `complete_putaway` comprobaba la posicion de seis formas pero no el area, y el filtro del
// almacen vive solo en la sugerencia: escaneando el codigo del anden a mano, la tarea cerraba
// y el pallet se quedaba en el anden. Desde ahi no lo ve el surtido ni la ocupacion, porque
// las 24 posiciones de anden son las unicas de la bodega sin area.

const { code: andenCode } = await one(`select code from location where id = $1`, [anden])
const { code: andenCarga } = await one(
  `select l.code from anden_de_carga a join location l on l.id = a.location_id order by 1 limit 1`,
)

// Los permisos salen de `roles_de_la_sesion()`, que mira `profile.is_active`, y el perfil
// nace inactivo. Las pruebas de arriba no lo necesitaban porque la cola y el guardado miran
// el turno y el dueno de la tarea; de aqui para abajo si, porque `buscar_hueco_otra_vez` y
// `cancelar_guardado` preguntan por el rol.
await db.query(`update profile set is_active = true where id in ('${yo}', '${otro}')`)

await como(yo)
const tercero = await one(
  `select * from receive_pallet('PAL-9201', $1, $2, 48, $3, 'L2603', '2027-06-01', 'rec-3')`,
  [productId, caseId, anden],
)
// Esta se asigna a mano y no por la cola: a estas alturas del guion hay varias tareas
// sueltas y una en la mano de `yo`, y la cola da primero lo empezado. Lo que se prueba aqui
// es el destino, no el reparto.
const suyaTres = { id: tercero.task_id }
await db.query(
  `update task set status = 'ASSIGNED', assigned_to = '${yo}', assigned_at = now()
   where id = $1`,
  [suyaTres.id],
)
await one(`select start_putaway($1, 'PAL-9201')`, [suyaTres.id])

const enElAnden = await fails(`select * from complete_putaway($1, $2)`, [suyaTres.id, andenCode])
check(enElAnden?.includes('no se guarda'), 'guardar un pallet en el anden de recibo se niega')

const enElDeCarga = await fails(`select * from complete_putaway($1, $2)`, [suyaTres.id, andenCarga])
check(
  enElDeCarga?.includes('no se guarda'),
  'y en el anden de despacho tambien: era el agujero que dejaba el crossdock',
)

const sigueAhi = await one(
  `select t.status::text as estado, t.qty_base = s.qty_base as entero, l.code as donde
   from task t
   join stock s on s.lpn_id = t.lpn_id and s.location_id = t.from_location_id
   join location l on l.id = s.location_id
   where t.id = $1`,
  [suyaTres.id],
)
check(
  sigueAhi.estado === 'IN_PROGRESS' && sigueAhi.entero && sigueAhi.donde === andenCode,
  'y no movio nada: la tarea sigue en la mano y el saldo entero en el anden',
)

const alHueco = await one(`select * from complete_putaway($1, $2)`, [
  suyaTres.id,
  tercero.to_location_code,
])
check(alHueco.era_la_sugerida === true, 'al hueco que le dijeron si lo deja')

// Y por el otro camino: `reordenar` valida el destino con `destino_valido`.
const aMano = await fails(`select * from reordenar($1, $2, 'PAL-9201')`, [
  tercero.to_location_code,
  andenCarga,
])
check(aMano?.includes('no se guarda'), 'reordenar tampoco deja mover producto a un anden')

// Pero sacarlo del anden sigue valiendo: aqui se mira a donde va, no de donde sale.
const { code: libre } = await one(
  `select l.code from location l
   join location_area la on la.location_id = l.id and la.valid_to is null
   join area a on a.id = la.area_id and a.code = 'ALMACEN'
   where l.status = 'available' and l.reserved_by_task_id is null
     and not exists (select 1 from stock s where s.location_id = l.id and s.qty_base > 0)
     and not exists (select 1 from stock s join location o on o.id = s.location_id
                     where o.carril = l.carril and s.qty_base > 0)
     and pallets_que_caben(l.id, $1) > 0
     and (l.grupo is null or l.grupo = grupo_del_producto($1))
   limit 1`,
  [productId],
)
const salida = await one(`select * from reordenar($1, $2, 'PAL-9201')`, [
  tercero.to_location_code,
  libre,
])
check(salida.a === libre, 'y mover un pallet de un hueco a otro sigue funcionando')

// -----------------------------------------------------------------------------------------
// Buscar hueco otra vez, y cerrar el guardado que no se puede cumplir (0119)
// -----------------------------------------------------------------------------------------
//
// Cuando al recibir no hay hueco la tarea nace con `to_location_id` en null, y el motor se
// llamaba solo al recibir: al liberarse uno, la tarea seguia sin destino para siempre.

await db.query(`update location set status = 'blocked'
  where id in (select la.location_id from location_area la where la.valid_to is null)`)

// `receive_pallet` no devuelve filas cuando no hay destino —su `return query` se une a la
// posicion sugerida—, asi que la tarea se lee de la base. Es funcion de pruebas: la pantalla
// de ingreso recibe por documento.
await db.query(
  `select * from receive_pallet('PAL-9301', $1, $2, 24, $3, 'L2604', '2027-07-01', 'rec-4')`,
  [productId, caseId, anden],
)
const sinHueco = await one(
  `select t.id as task_id, t.lpn_id, t.to_location_id, t.status::text as estado
   from task t join lpn on lpn.id = t.lpn_id
   where lpn.code = 'PAL-9301' and t.type = 'PUTAWAY'`,
)
check(
  sinHueco.to_location_id === null && sinHueco.estado === 'READY',
  'con la bodega llena, el pallet se recibe igual y la tarea nace sin destino',
)

const sigueSin = await fails(`select * from buscar_hueco_otra_vez($1)`, [sinHueco.task_id])
check(
  sigueSin?.includes('Sigue sin haber hueco'),
  'y preguntar otra vez lo dice con palabras, no devuelve nada en silencio',
)

await db.query(`update location set status = 'available' where code = $1`, [libre])
await db.query(`delete from stock where location_id = (select id from location where code = $1)`, [
  libre,
])

const ahoraSi = await one(`select * from buscar_hueco_otra_vez($1)`, [sinHueco.task_id])
check(ahoraSi.code === libre, 'en cuanto se libera uno, la tarea ya tiene a donde ir')
check(ahoraSi.era_la_misma === false, 'y dice que no es la de antes, porque antes no habia')

const apartado = await one(
  `select l.reserved_by_task_id = $1 as mia, l.reserved_until is not null as con_plazo,
          t.to_location_id = l.id as en_la_tarea, t.zone_id is not null as con_zona
   from location l, task t where l.code = $2 and t.id = $1`,
  [sinHueco.task_id, libre],
)
check(
  apartado.mia && apartado.con_plazo && apartado.en_la_tarea && apartado.con_zona,
  'el hueco queda apartado con plazo, y la tarea con su destino y su zona',
)

// El callejon de verdad: lo que no tiene hueco de su grupo. La vieja `crossdock()` era la
// unica funcion que cancelaba un PUTAWAY; al quitarla no quedo ninguna.
await db.query(`update location set status = 'blocked', reserved_by_task_id = null,
  reserved_until = null where code = $1`, [libre])

const noEsSuyo = await fails(`select cancelar_guardado($1, 'no hay hueco de su grupo')`, [
  sinHueco.task_id,
])
check(
  noEsSuyo?.includes('cosa del jefe de bodega'),
  'el auxiliar no cierra un guardado: es decision del jefe',
)

await db.query(`update profile set role = 'supervisor' where id = '${yo}'`)

const sinRazon = await fails(`select cancelar_guardado($1, '')`, [sinHueco.task_id])
check(sinRazon?.includes('Escribe por qué'), 'y ni el jefe lo cierra sin decir por que')

await one(`select cancelar_guardado($1, 'no hay hueco de su grupo')`, [sinHueco.task_id])

const elCierre = await one(
  `select t.status::text as estado, t.closed_reason, t.completed_at is not null as con_fecha,
          (select count(*)::int from location l where l.reserved_by_task_id = t.id) as apartados,
          (select l.code from stock s join location l on l.id = s.location_id
            where s.lpn_id = t.lpn_id and s.qty_base > 0) as donde,
          (select s.qty_base = t.qty_base from stock s
            where s.lpn_id = t.lpn_id and s.qty_base > 0) as entero
   from task t where t.id = $1`,
  [sinHueco.task_id],
)
check(elCierre.estado === 'CANCELLED', 'el jefe si la cierra')
check(elCierre.closed_reason === 'no hay hueco de su grupo', 'y queda escrito por que')
check(elCierre.apartados === 0, 'el hueco que tenia apartado se suelta')
check(
  elCierre.entero === true && elCierre.donde === andenCode,
  'y el pallet se queda en el anden, con su saldo: no se mueve ni se borra',
)

const yaCerrada = await fails(`select cancelar_guardado($1, 'otra vez')`, [sinHueco.task_id])
check(yaCerrada?.includes('ya está cancelada'), 'y no se cierra dos veces')

const yaGuardada = await fails(`select cancelar_guardado($1, 'tarde')`, [suyaTres.id])
check(yaGuardada?.includes('ya se guardó'), 'ni se cierra una que ya se cumplio')

await db.close()
