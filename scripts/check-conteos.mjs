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

const origen = await posicion('F3-001-01')
const { id: pallet } = await one(
  `insert into lpn (code, level, source) values ('WMS-00009001', 'PALLET', 'PROVISIONAL')
   returning id`,
)
await one(
  `select post_movement('RECEIPT'::movement_type, $1::uuid, 240::numeric, null, $2::uuid,
     $3::uuid, 'L1'::text, '2027-06-30'::date)`,
  [producto, origen.id, pallet],
)

const sinNada = await fails(`select * from reordenar('F3-005-01', 'F3-005-02')`)
check(sinNada?.includes('no hay nada que mover'), 'de una posicion vacia no se mueve nada')

const aLaNada = await fails(`select * from reordenar('F3-001-01', 'ZZZ-999')`)
check(aLaNada?.includes('No existe la posición'), 'un destino inventado se rechaza por su nombre')

const alMismo = await fails(`select * from reordenar('F3-001-01', 'F3-001-01')`)
check(alMismo?.includes('Ya está en'), 'mover algo a donde ya esta se rechaza, no se duplica')

const movido = await one(`select * from reordenar('F3-001-01', 'F3-001-02')`)
check(
  movido.pallet === 'WMS-00009001' && Number(movido.cantidad) === 240,
  'el reordenamiento saca el producto y la cantidad de la existencia, sin teclear nada',
)
check(
  movido.de === 'F3-001-01' && movido.a === 'F3-001-02',
  'y dice de donde salio y a donde fue',
)
check(Number((await saldo('F3-001-01')).qty) === 0, 'el origen queda en cero')
check(Number((await saldo('F3-001-02')).qty) === 240, 'y el destino con las 240')

const porMatricula = await one(`select * from reordenar('WMS-00009001', 'F3-001-03')`)
check(
  porMatricula.de === 'F3-001-02' && porMatricula.a === 'F3-001-03',
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
await db.query(`update location set max_pallets_stacked = 3 where code = 'F3-001-03'`)
await db.query(
  `insert into pallet_config (product_id, pallet_type_code, cases_per_layer, layers,
     cases_per_pallet, allows_stacking, max_stack, is_default)
   values ($1, 'STD', 10, 12, 120, true, 3, true)`,
  [producto],
)
await one(
  `select post_movement('RECEIPT'::movement_type, $1::uuid, 240::numeric, null, $2::uuid,
     $3::uuid, 'L1'::text, '2027-06-30'::date)`,
  [producto, (await posicion('F3-001-03')).id, pallet2],
)

const ambiguo = await fails(`select * from reordenar('F3-001-03', 'F3-001-04')`)
check(
  ambiguo?.includes('Escanea la matrícula del pallet'),
  'con dos pallets en la posicion pide la matricula, no mueve el que se le antoje',
)
check(
  ambiguo?.includes('WMS-00009001') && ambiguo?.includes('WMS-00009002'),
  'y nombra los dos pallets que hay, para que el que escanea sepa cuales son',
)

const elegido = await one(`select * from reordenar('F3-001-03', 'F3-001-04', 'WMS-00009002')`)
check(elegido.pallet === 'WMS-00009002', 'con la matricula mueve justo ese pallet')
check(Number((await saldo('F3-001-03')).qty) === 240, 'y el otro se queda donde estaba')

const ajeno = await fails(`select * from reordenar('F3-001-03', 'F3-001-04', 'WMS-00000999')`)
check(ajeno?.includes('no está en'), 'una matricula que no esta ahi se rechaza diciendolo')

// --- y tampoco se mueve lo que el equipo no puede mover (0107) ---------------------------
//
// El reparto de tareas si mira la maquina; esta pantalla no miraba nada. Medido a clic el
// 25/11/2026 en produccion: con un montacargas de piso se subio de verdad un pallet a un
// nivel 1 de rack, y el movimiento quedo apuntado a nombre de quien no podia haberlo hecho.
//
// Manda el extremo de rack del movimiento, igual que `task.min_level`: si uno de los dos
// lados esta en alto, el movimiento es de rack. Asi bajar de rack al piso sigue siendo del de
// rack —que es como se reabastece la cara a mano— y el de piso no sube nada.
const { code: arriba } = await one(
  `select code from location
    where kind = 'rack_double_deep' and level >= 1 and retired_at is null
    order by code limit 1`,
)

const aPieNoSube = await fails(`select * from reordenar('F3-001-03', $1)`, [arriba])
check(
  aPieNoSube?.includes('tu equipo no llega'),
  'a pie no se sube un pallet al rack, aunque la pantalla lo deje escanear',
)

await one(`select iniciar_turno('MONTACARGA_RACK')`)
const deRackNoBaja = await fails(`select * from reordenar('F3-001-03', 'F3-001-02')`)
check(
  deRackNoBaja?.includes('todo de piso'),
  'y con el de rack no se acomoda el piso: eso lo mueve uno de piso',
)
await one(`select cerrar_turno()`)

// ---------------------------------------------------------------------------------------
// El recuento del dia a dia
// ---------------------------------------------------------------------------------------

const { id: dock } = await one(`select id from dock_door where code = 'AND-03'`)
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

// Picking para que el surtido pueda tomar cajas sueltas. La cara es la boca del carril —al
// fondo no se llega sin bajar lo de adelante— y lo que ya quedo en F3-001 es la existencia de
// donde sacar lo que falte cuando el recuento baje la cantidad.
for (const cara of ['F3-002-18', 'F3-003-18']) {
  await db.query(`select reasignar_area_por_codigo($1, 'PICKING')`, [cara])
  await one(
    `select post_movement('RECEIPT'::movement_type, $1::uuid, 240::numeric, null, $2::uuid, null,
       'L1'::text, '2027-06-30'::date)`,
    [producto, (await posicion(cara)).id],
  )
}

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

// Y de paso, lo que el reordenamiento promete y no estaba probado: lo apartado no se mueve.
const apartadoNoSeMueve = await fails(`select * from reordenar($1, 'F3-005-02')`, [
  apartadoAqui[0].code,
])
check(
  apartadoNoSeMueve?.includes('apartado para un pedido'),
  'lo apartado para un pedido no se reordena: quien va a surtir se quedaria mirando un hueco',
)


await como(miron)
const sinPermiso = await fails(`select * from recontar('F3-001-03', 5)`)
check(sinPermiso?.includes('No tienes permiso'), 'quien solo mira no cambia cantidades')

await como(auxiliar)

const cero = await fails(`select * from recontar('F3-001-03', null)`)
check(cero?.includes('cuántas cajas hay'), 'sin cantidad no hay recuento')

const vacia = await fails(`select * from recontar('F3-009-09', 3)`)
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

// Un descuadre sin razon escrita no se guarda: mueve el saldo igual que un despacho corto.
const sinRazon = await fails(`select * from recontar($1, $2)`, [lugarContado, deciaCajas - 5])
check(sinRazon?.includes('escribe por qué'), 'un recuento que no cuadra sin razon no se guarda')

const r = await one(`select * from recontar($1, $2, 0, null, $3)`, [
  lugarContado,
  deciaCajas - 5,
  'faltaban cinco cajas en el pallet',
])
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
check(
  !/\.\d{3,}/.test(r.de_donde),
  'y lo dice en cajas de verdad, no en un numero de diecisiete decimales',
)

const comoSeDice = await one(
  `select texto_cajas(955, 24) as mixto, texto_cajas(48, 24) as redondo,
          texto_cajas(7, 24) as poquito, texto_cajas(25, 24) as una,
          texto_cajas(1, 24) as suelta`,
)
check(
  comoSeDice.mixto === '39 cajas y 19 sueltas' &&
    comoSeDice.redondo === '2 cajas' &&
    comoSeDice.poquito === '7 sueltas',
  'una cantidad se dice como en la bodega: cajas, y sueltas solo si las hay',
)
check(
  comoSeDice.una === '1 caja y 1 suelta' && comoSeDice.suelta === '1 suelta',
  'y en singular cuando es una: «1 cajas y 1 sueltas» no lo dice nadie',
)

const movCount = await one(
  `select type::text, reason_code, qty_base, note from stock_movement
   where type = 'COUNT' order by id desc limit 1`,
)
check(
  movCount && Number(movCount.qty_base) === 120 && movCount.reason_code === 'AJUSTE_CNT',
  'el ajuste queda en el libro mayor como conteo, con su motivo',
)
check(
  movCount.note?.includes('el sistema decía') &&
    movCount.note?.includes('faltaban cinco cajas en el pallet'),
  'y la nota del libro mayor lleva las dos cosas: cuanto decia el sistema y por que no cuadro',
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
const razon = await one(
  `select note from stock_count order by counted_at desc, id desc limit 1`,
)
check(
  razon.note === 'faltaban cinco cajas en el pallet',
  'y la razon del descuadre queda escrita, que es lo que faltaba en los once de produccion',
)

// Un conteo que cuadra tambien cuenta: sin el no hay con que dividir.
const hayAhi = Number((await saldo('F3-001-03')).qty) / 24
const cuadra = await one(`select * from recontar('F3-001-03', $1)`, [hayAhi])
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
const masDeLoQueDecia = await one(
  `select * from recontar('F3-001-03', $1, 0, null, 'aparecieron dos cajas mas')`,
  [hayAhi + 2],
)
check(Number(masDeLoQueDecia.diferencia) === 2, 'el recuento tambien sube la cantidad')
check(
  Number((await saldo('F3-001-03')).qty) === (hayAhi + 2) * 24,
  'y el saldo sube con el: dos cajas mas son 48 unidades mas',
)

// Las sueltas se cuentan aparte. Confirmar lo que pinta la pantalla no puede borrarlas:
// una posicion de picking casi nunca tiene un numero redondo de cajas.
const redondas = Number((await saldo('F3-001-03')).qty) / 24
await one(`select * from recontar('F3-001-03', $1, 7, null, 'quedaron siete sueltas')`, [
  redondas,
])
const vista = await one(`select cajas, sueltas from inventario where location_code = 'F3-001-03'`)
check(
  Number(vista.cajas) === redondas && Number(vista.sueltas) === 7,
  'una posicion puede quedar en cajas enteras mas unidades sueltas',
)
const confirmado = await one(`select * from recontar('F3-001-03', $1, $2)`, [
  vista.cajas,
  vista.sueltas,
])
check(
  Number(confirmado.diferencia) === 0,
  'y confirmar lo que la pantalla pinta cuadra, en vez de comerse las sueltas',
)
check(
  Number((await saldo('F3-001-03')).qty) === redondas * 24 + 7,
  'el saldo se queda igual: las siete sueltas siguen ahi',
)
check(
  Number(confirmado.decia) === redondas && Number(confirmado.decia_sueltas) === 7,
  'y lo que decia el sistema vuelve en cajas y sueltas, no en un 5.29 que nadie lee',
)
const enNegativo = await fails(`select * from recontar('F3-001-03', 1, -1)`)
check(
  enNegativo?.includes('menos que cero'),
  'contar sueltas en negativo no tiene sentido y se rechaza',
)

// Y el caso que de verdad duele: la tarea de surtido ya esta repartida y en la mano de
// alguien cuando aparece el descuadre. Lo que quede recortado tiene que seguir siendo surtible,
// porque si no el que esta surtiendo se queda con una tarea que no puede cerrar.
const { id: linea2 } = await one(
  `insert into order_line (order_id, line_no, product_id, packaging_level_id, qty_base)
   values ($1, 2, $2, $3, 120) returning id`,
  [pedido, producto, caja],
)
await db.query(`select apartar_linea($1)`, [linea2])

await como(auxiliar)
await db.query(`select iniciar_turno()`)
const enMano = await one(`select * from claim_next_task(array['PICK']::task_type[])`)
check(enMano?.type === 'PICK', 'alguien toma la tarea de surtido y la tiene en la mano')

const dondeEstaba = await one(`select code from location where id = $1`, [
  enMano.from_location_id,
])
const antesDeRecortar = await one(
  `select s.qty_base, s.qty_allocated from stock s
   join location l on l.id = s.location_id where l.code = $1 and s.qty_base > 0`,
  [dondeEstaba.code],
)
check(
  Number(antesDeRecortar.qty_allocated) >= Number(enMano.qty_base),
  'y lo suyo esta apartado en esa posicion',
)

await one(`select start_pick($1, $2)`, [enMano.id, dondeEstaba.code])
const empezada = await one(`select status::text from task where id = $1`, [enMano.id])
check(empezada.status === 'IN_PROGRESS', 'y la empieza: ya esta parada frente a la posicion')

const menos = Number(enMano.qty_base) - 24
const recortada = await one(`select * from recontar($1, $2, $3, null, $4)`, [
  dondeEstaba.code,
  Math.floor(menos / 24),
  menos % 24,
  'se llevaron una caja sin apuntarla',
])
check(Number(recortada.diferencia) < 0, 'el recuento baja la cantidad con la tarea ya repartida')

const quedo = await one(`select status::text, qty_base from task where id = $1`, [enMano.id])
check(
  quedo.status !== 'CANCELLED' && Number(quedo.qty_base) === menos,
  'la tarea que estaba en la mano se recorta a lo que si hay, no se cancela',
)

await db.query(
  `insert into barcode (packaging_level_id, code, symbology, is_primary)
   values ($1, 'PRUEBACONTEO01', 'CODE128', true)`,
  [caja],
)
const { cajas: cajasMenos, sueltas: sueltasMenos } = await one(
  `select * from desglose((select product_id from task where id = $1), $2)`,
  [enMano.id, menos],
)
const surtido = await one(`select * from complete_pick($1, 'PRUEBACONTEO01', $2, $3)`, [
  enMano.id,
  cajasMenos,
  sueltasMenos,
])
check(
  Number(surtido.surtido) === menos,
  'y se puede cerrar por lo recortado: nadie se queda con una tarea imposible',
)

await db.query(`delete from shift_assignment where profile_id = $1`, [auxiliar])

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
const conExistencia = await one(
  `select count(distinct s.location_id)::int as n from stock s
   where s.qty_base > 0 and (area_de(s.location_id)).code = 'PICKING'`,
)
const solas = await one(`select * from lanzar_conteo(null, 'PICKING')`)
check(
  Number(solas.tareas) === conExistencia.n && conExistencia.n > 0,
  `el conteo del area de picking arma una tarea por posicion con existencia (${conExistencia.n})`,
)
check(Number(solas.personas) === 0, 'sin nadie trabajando no hay a quien repartir')
check(Number(solas.repartidas) === 0, 'y las tareas quedan en la cola, sin dueno')

const enCola = await one(
  `select count(*)::int as n from task where type = 'COUNT' and status = 'READY'`,
)
check(enCola.n === Number(solas.tareas), 'todas listas para que las tome el que entre')

// Lo que queda en la cola tiene que poder tomarse: si no, un conteo lanzado cuando no habia
// nadie trabajando no aparece nunca en la lista de nadie.
await como(auxiliar)
await db.query(`select iniciar_turno()`)
const tomada = await one(`select * from claim_next_task(array['COUNT']::task_type[])`)
check(
  tomada?.type === 'COUNT' && tomada.assigned_to === auxiliar,
  'una posicion que quedo en la cola se puede tomar como cualquier otra tarea',
)
await db.query(
  `update task set status = 'READY', assigned_to = null, assigned_at = null where id = $1`,
  [tomada.id],
)
await db.query(`delete from shift_assignment where profile_id = '${auxiliar}'`)
await como(jefe)

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
const cuenta = await one(`select * from recontar($1, 10, 0, null, $2, $3)`, [
  cerrada[0].posicion,
  'conteo ciclico: habia menos de lo apuntado',
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

// La red: la regla no vive solo en `recontar`. Una pantalla nueva o un script que escriba un
// recuento a mano se topa con lo mismo, que es de lo que se trata bajarla a la base.
const aMano = await fails(
  `insert into stock_count (location_id, product_id, qty_expected, qty_found)
   select l.id, $1::uuid, 100, 90 from location l limit 1`,
  [producto],
)
check(
  aMano?.includes('escribe por qué'),
  'un recuento escrito a mano sin razon tampoco entra: la regla es de la tabla',
)
const conRazon = await fails(
  `insert into stock_count (location_id, product_id, qty_expected, qty_found, note)
   select l.id, $1::uuid, 100, 90, 'se mojo' from location l limit 1`,
  [producto],
)
check(conRazon === null, 'y con razon escrita entra')
