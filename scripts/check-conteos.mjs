import { bootDb, check } from './lib/boot-db.mjs'

/**
 * Reordenar y contar. Las dos cosas comparten lo mismo: se escanea el lugar y el sistema ya
 * sabe que hay, asi que no se teclea producto ni lote. Lo que se prueba aqui es que de verdad
 * no haga falta teclearlo, que el pallet desempate cuando hay varios, y que el recuento que
 * baja la cantidad no deje a nadie surtiendo de un hueco.
 */
const db = await bootDb()
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const todas = async (sql, params) => (await db.query(sql, params)).rows
const fails = async (sql, params) =>
  db.query(sql, params).then(
    () => null,
    (e) => e.message,
  )

const { id: jefe } = await one(
  `insert into auth.users (email) values ('jefe@ejemplo.test') returning id`,
)
const { id: auxiliar } = await one(
  `insert into auth.users (email) values ('aux@ejemplo.test') returning id`,
)
const { id: miron } = await one(
  `insert into auth.users (email) values ('miron@ejemplo.test') returning id`,
)
await db.query(
  `update profile set is_active = true, approved_at = now(), role = 'supervisor' where id = '${jefe}'`,
)
await db.query(
  `update profile set is_active = true, approved_at = now(), role = 'auxiliar' where id = '${auxiliar}'`,
)
await db.query(
  `update profile set is_active = true, approved_at = now(), role = 'solo_lectura' where id = '${miron}'`,
)
const como = (id) => db.query(`select set_config('request.jwt.claim.sub', '${id}', false)`)

const { id: producto } = await one(
  `insert into product (sku, name, base_uom, requires_fefo) values ('C-1', 'Galleta', 'ST', true)
   returning id`,
)
const { id: caja } = await one(
  `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 24)
   returning id`,
  [producto],
)

const posicion = async (code) => one(`select id, code from location where code = $1`, [code])
const saldo = async (code) =>
  one(
    `select coalesce(sum(s.qty_base), 0)::numeric as qty
     from stock s join location l on l.id = s.location_id where l.code = $1`,
    [code],
  )

await como(jefe)

// ---------------------------------------------------------------------------------------
// Reordenar: dos escaneos
// ---------------------------------------------------------------------------------------

const origen = await posicion('F1-001-01')
const destino = await posicion('F1-001-02')
const { id: pallet } = await one(
  `insert into lpn (code, level, source) values ('WMS-00009001', 'PALLET', 'PROVISIONAL')
   returning id`,
)
await one(
  `select post_movement('RECEIPT'::movement_type, $1::uuid, 240::numeric, null, $2::uuid,
     $3::uuid, 'L1'::text, '2027-06-30'::date)`,
  [producto, origen.id, pallet],
)

const sinNada = await fails(`select * from reordenar('F1-005-01', 'F1-005-02')`)
check(sinNada?.includes('no hay nada que mover'), 'de una posicion vacia no se mueve nada')

const aLaNada = await fails(`select * from reordenar('F1-001-01', 'ZZZ-999')`)
check(aLaNada?.includes('No existe la posición'), 'un destino inventado se rechaza por su nombre')

const alMismo = await fails(`select * from reordenar('F1-001-01', 'F1-001-01')`)
check(alMismo?.includes('Ya está en'), 'mover algo a donde ya esta se rechaza, no se duplica')

const movido = await one(`select * from reordenar('F1-001-01', 'F1-001-02')`)
check(
  movido.pallet === 'WMS-00009001' && Number(movido.cantidad) === 240,
  'el reordenamiento saca el producto y la cantidad de la existencia, sin teclear nada',
)
check(
  movido.de === 'F1-001-01' && movido.a === 'F1-001-02',
  'y dice de donde salio y a donde fue',
)
check(Number((await saldo('F1-001-01')).qty) === 0, 'el origen queda en cero')
check(Number((await saldo('F1-001-02')).qty) === 240, 'y el destino con las 240')

const porMatricula = await one(`select * from reordenar('WMS-00009001', 'F1-001-03')`)
check(
  porMatricula.de === 'F1-001-02' && porMatricula.a === 'F1-001-03',
  'la matricula del pallet sirve de primer escaneo: el sistema ya sabe donde esta',
)

const { type: tipo, reason_code: motivo } = await one(
  `select type::text, reason_code from stock_movement order by id desc limit 1`,
)
check(tipo === 'MOVE' && motivo === 'TRASLADO', 'el reordenamiento queda en el libro como traslado')

// Varios pallets en la misma posicion: el lugar ya no dice cual se mueve.
const { id: pallet2 } = await one(
  `insert into lpn (code, level, source) values ('WMS-00009002', 'PALLET', 'PROVISIONAL')
   returning id`,
)
await db.query(`update location set max_pallets_stacked = 3 where code = 'F1-001-03'`)
await db.query(
  `insert into pallet_config (product_id, pallet_type_code, cases_per_layer, layers,
     cases_per_pallet, allows_stacking, max_stack, is_default)
   values ($1, 'STD', 10, 12, 120, true, 3, true)`,
  [producto],
)
await one(
  `select post_movement('RECEIPT'::movement_type, $1::uuid, 240::numeric, null, $2::uuid,
     $3::uuid, 'L1'::text, '2027-06-30'::date)`,
  [producto, (await posicion('F1-001-03')).id, pallet2],
)

const ambiguo = await fails(`select * from reordenar('F1-001-03', 'F1-001-04')`)
check(
  ambiguo?.includes('Escanea la matrícula del pallet'),
  'con dos pallets en la posicion pide la matricula, no mueve el que se le antoje',
)
check(
  ambiguo?.includes('WMS-00009001') && ambiguo?.includes('WMS-00009002'),
  'y nombra los dos pallets que hay, para que el que escanea sepa cuales son',
)

const elegido = await one(`select * from reordenar('F1-001-03', 'F1-001-04', 'WMS-00009002')`)
check(elegido.pallet === 'WMS-00009002', 'con la matricula mueve justo ese pallet')
check(Number((await saldo('F1-001-03')).qty) === 240, 'y el otro se queda donde estaba')

const ajeno = await fails(`select * from reordenar('F1-001-03', 'F1-001-04', 'WMS-00000999')`)
check(ajeno?.includes('no está en'), 'una matricula que no esta ahi se rechaza diciendolo')

// ---------------------------------------------------------------------------------------
// El recuento del dia a dia
// ---------------------------------------------------------------------------------------

const { id: dock } = await one(`select id from dock_door where code = 'AND-S-03'`)
const { id: pedido } = await one(
  `insert into sales_order (code, customer, dock_door_id) values ('PED-C1', 'Cliente', $1)
   returning id`,
  [dock],
)
const { id: linea } = await one(
  `insert into order_line (order_id, line_no, product_id, packaging_level_id, qty_base)
   values ($1, 1, $2, $3, 240) returning id`,
  [pedido, producto, caja],
)

// Picking para que el surtido pueda tomar cajas sueltas, y una segunda posicion con existencia
// de donde sacar lo que falte cuando el recuento baje la cantidad.
await db.query(`select reasignar_area_por_codigo('F1-00%', 'PICKING')`)
await one(
  `select post_movement('RECEIPT'::movement_type, $1::uuid, 240::numeric, null, $2::uuid, null,
     'L1'::text, '2027-06-30'::date)`,
  [producto, (await posicion('F1-002-01')).id],
)

await db.query(`select apartar_linea($1)`, [linea])
const apartado = await one(
  `select coalesce(sum(qty_base), 0)::numeric as qty from allocation where order_line_id = $1`,
  [linea],
)
check(Number(apartado.qty) === 240, 'el pedido queda apartado entero antes del recuento')

const apartadoAqui = await todas(
  `select l.code, a.qty_base from allocation a
   join stock s on s.id = a.stock_id join location l on l.id = s.location_id
   where a.order_line_id = $1 order by l.code`,
  [linea],
)
check(apartadoAqui.length >= 1, 'y el apartado apunta a una posicion concreta')

await como(miron)
const sinPermiso = await fails(`select * from recontar('F1-001-03', 5)`)
check(sinPermiso?.includes('No tienes permiso'), 'quien solo mira no cambia cantidades')

await como(auxiliar)

const cero = await fails(`select * from recontar('F1-001-03', null)`)
check(cero?.includes('cuántas cajas hay'), 'sin cantidad no hay recuento')

const vacia = await fails(`select * from recontar('F1-009-09', 3)`)
check(
  vacia?.includes('carga inicial'),
  'contar donde el sistema no tiene nada manda a la carga inicial, que es lo que es',
)

// El caso tal cual: el sistema dice 10 cajas y hay 5.
const lugarContado = apartadoAqui[0].code
const antes = await one(
  `select s.qty_base, s.qty_allocated from stock s
   join location l on l.id = s.location_id where l.code = $1 and s.qty_base > 0`,
  [lugarContado],
)
const deciaCajas = Number(antes.qty_base) / 24

const r = await one(`select * from recontar($1, $2)`, [lugarContado, deciaCajas - 5])
check(Number(r.decia) === deciaCajas, `el recuento dice que el sistema tenia ${deciaCajas} cajas`)
check(Number(r.habia) === deciaCajas - 5, 'y que habia cinco menos')
check(Number(r.diferencia) === -5, 'la diferencia la calcula el servidor, no la pantalla')

const despues = await one(
  `select s.qty_base, s.qty_allocated from stock s
   join location l on l.id = s.location_id where l.code = $1 order by s.qty_base desc limit 1`,
  [lugarContado],
)
check(
  Number(despues.qty_base) === Number(antes.qty_base) - 120,
  'el saldo baja a lo que de verdad hay',
)
check(
  Number(despues.qty_allocated) <= Number(despues.qty_base),
  'y lo apartado nunca queda por encima de lo que hay',
)

check(Number(r.tareas) >= 1, 'el sistema arma la tarea para sacar lo que falta de otro lado')
check(
  typeof r.de_donde === 'string' && r.de_donde.length > 0,
  `y dice de donde sacarlo (${r.de_donde})`,
)
check(!r.de_donde.includes(lugarContado), 'de otro lado, no del que acaba de contar')

const movCount = await one(
  `select type::text, reason_code, qty_base, note from stock_movement
   where type = 'COUNT' order by id desc limit 1`,
)
check(
  movCount && Number(movCount.qty_base) === 120 && movCount.reason_code === 'AJUSTE_CNT',
  'el ajuste queda en el libro mayor como conteo, con su motivo',
)
check(
  movCount.note?.includes('Recuento'),
  'y con la nota puesta sola: el motivo la exige y nadie va a teclearla con el lector en la mano',
)

const hist = await one(
  `select persona, posicion, qty_expected, qty_found, diferencia from recuentos
   order by counted_at desc limit 1`,
)
check(hist.persona !== null, 'el historial guarda el nombre de quien lo hizo')
check(
  Number(hist.diferencia) === -120,
  'y cuanto decia y cuanto habia, que es de donde sale la inexactitud',
)

// Un conteo que cuadra tambien cuenta: sin el no hay con que dividir.
const hayAhi = Number((await saldo('F1-001-03')).qty) / 24
const cuadra = await one(`select * from recontar('F1-001-03', $1)`, [hayAhi])
check(Number(cuadra.diferencia) === 0, 'un recuento que cuadra no mueve nada')
const conteosDe = await one(`select conteos, descuadres from inexactitud where profile_id = $1`, [
  auxiliar,
])
check(
  Number(conteosDe.conteos) === 2 && Number(conteosDe.descuadres) === 1,
  'el porcentaje de inexactitud sale de los dos: los que cuadraron y los que no',
)
const pct = await one(`select pct_conteos_con_descuadre from inexactitud where profile_id = $1`, [
  auxiliar,
])
check(Number(pct.pct_conteos_con_descuadre) === 50, 'uno de dos descuadrado es el 50%')

const movimientos = await one(
  `select count(*)::int as n from stock_movement where type = 'COUNT'`,
)
check(movimientos.n === 1, 'y el que cuadro no dejo movimiento, porque no movio nada')

// Hacia arriba tambien: habia mas de lo que decia.
const masDeLoQueDecia = await one(`select * from recontar('F1-001-03', $1)`, [hayAhi + 2])
check(Number(masDeLoQueDecia.diferencia) === 2, 'el recuento tambien sube la cantidad')
check(
  Number((await saldo('F1-001-03')).qty) === (hayAhi + 2) * 24,
  'y el saldo sube con el: dos cajas mas son 48 unidades mas',
)

// ---------------------------------------------------------------------------------------
// Los conteos ciclicos del supervisor
// ---------------------------------------------------------------------------------------

await como(auxiliar)
const noLanza = await fails(`select * from lanzar_conteo('f1')`)
check(noLanza?.includes('Sólo la supervisión'), 'un auxiliar no lanza conteos')

await como(jefe)
const sinCriterio = await fails(`select * from lanzar_conteo()`)
check(
  sinCriterio?.includes('al menos una cosa'),
  'un conteo sin criterio no se lanza: seria la bodega entera por descuido',
)

const zonaInventada = await fails(`select * from lanzar_conteo('pasillo-inventado')`)
check(zonaInventada?.includes('No hay zona'), 'una zona que no existe se rechaza por su nombre')

const areaInventada = await fails(`select * from lanzar_conteo(null, 'NO-EXISTE')`)
check(areaInventada?.includes('No hay ningún área'), 'y un area que no existe, igual')

// Nadie trabajando: las tareas quedan en la cola.
const solas = await one(`select * from lanzar_conteo(null, 'PICKING')`)
check(Number(solas.tareas) >= 3, `el conteo del area de picking arma una tarea por posicion con existencia (${solas.tareas})`)
check(Number(solas.personas) === 0, 'sin nadie trabajando no hay a quien repartir')
check(Number(solas.repartidas) === 0, 'y las tareas quedan en la cola, sin dueno')

const enCola = await one(
  `select count(*)::int as n from task where type = 'COUNT' and status = 'READY'`,
)
check(enCola.n === Number(solas.tareas), 'todas listas para que las tome el que entre')

const repetido = await fails(`select * from lanzar_conteo(null, 'PICKING')`)
check(
  repetido?.includes('ya está lanzado'),
  'lanzarlo dos veces no duplica tareas: avisa que ya esta',
)

// Con gente trabajando: a cada quien un tramo seguido del recorrido.
await db.query(`delete from task where type = 'COUNT'`)
const { id: otro } = await one(
  `insert into auth.users (email) values ('aux2@ejemplo.test') returning id`,
)
await db.query(
  `update profile set is_active = true, approved_at = now(), role = 'auxiliar' where id = '${otro}'`,
)
await como(auxiliar)
await db.query(`select iniciar_turno()`)
await como(otro)
await db.query(`select iniciar_turno()`)

await como(jefe)
const repartido = await one(`select * from lanzar_conteo(null, 'PICKING')`)
check(Number(repartido.personas) === 2, 'reparte entre los dos que estan trabajando')
check(
  Number(repartido.repartidas) === Number(repartido.tareas),
  'y no deja ninguna tarea sin dueno',
)

const tramos = await todas(
  `select assigned_to, min(posicion) as primera, max(posicion) as ultima, count(*)::int as n
   from conteos_pendientes group by assigned_to order by primera`,
)
check(tramos.length === 2, 'cada quien con su tramo')
check(
  tramos[0].ultima < tramos[1].primera,
  'y los tramos son seguidos, no salteados: nadie vuelve por donde ya paso',
)

const cerrada = await todas(
  `select task_id, posicion from conteos_pendientes where assigned_to = $1 order by posicion`,
  [auxiliar],
)
await como(auxiliar)
const cuenta = await one(`select * from recontar($1, 10, null, null, $2)`, [
  cerrada[0].posicion,
  cerrada[0].task_id,
])
check(cuenta !== undefined, 'la tarea de conteo acepta el recuento de su posicion')
const conTarea = await one(
  `select task_id from stock_count order by counted_at desc, id desc limit 1`,
)
check(conTarea.task_id === cerrada[0].task_id, 'y el historial queda amarrado a la tarea')

await one(`select * from cerrar_conteo($1)`, [cerrada[0].task_id])
const cerradaYa = await one(`select status::text from task where id = $1`, [cerrada[0].task_id])
check(cerradaYa.status === 'DONE', 'cerrar el conteo cierra la tarea')

const ajena = await fails(`select * from cerrar_conteo($1)`, [
  (await todas(`select task_id from conteos_pendientes where assigned_to = $1 limit 1`, [otro]))[0]
    .task_id,
])
check(ajena?.includes('no es tuya'), 'nadie cierra el conteo de otro')

// El alcance: un conteo de rack no se le deja a quien anda a pie.
await db.query(`delete from task where type = 'COUNT'`)
const rack = await one(
  `select l.code, l.id from location l join lane la on la.id = l.lane_id
   join zone z on z.id = la.zone_id
   where z.kind = 'rack' and l.level = 3 limit 1`,
)
await one(
  `select post_movement('RECEIPT'::movement_type, $1::uuid, 240::numeric, null, $2::uuid, null,
     'L9'::text, '2027-09-30'::date)`,
  [producto, rack.id],
)
await como(jefe)
const enAlto = await one(`select * from lanzar_conteo(null, null, 3)`)
check(Number(enAlto.tareas) >= 1, 'el conteo del nivel 3 arma su tarea')
check(
  Number(enAlto.repartidas) === 0,
  'y no se la reparte a los dos de piso: sin montacargas de rack no alcanzan',
)
const minLevel = await one(
  `select min_level from task where type = 'COUNT' order by created_at desc limit 1`,
)
check(minLevel.min_level === 3, 'la tarea lleva el nivel, para que la cola mire el alcance')
