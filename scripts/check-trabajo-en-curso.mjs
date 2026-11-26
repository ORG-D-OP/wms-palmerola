import { bootDb, check } from './lib/boot-db.mjs'

/**
 * Lo que uno trae entre manos no se pierde al salir de la pantalla.
 *
 * El trabajo a medias siempre estuvo guardado —los pallets recibidos están en la base desde
 * el primer escaneo—, pero el documento abierto vivía en el navegador: al volver del tablero
 * la pantalla pedía escanear el pedido otra vez. Lo que faltaba en la base era **en qué andén
 * se está descargando ese camión**, que es lo que hace que quien esté parado ahí lo retome.
 */
const db = await bootDb()
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const como = (id) => db.query(`select set_config('request.jwt.claim.sub', '${id}', false)`)

const gente = async (correo, rol) => {
  const { id } = await one(`insert into auth.users (email) values ('${correo}') returning id`)
  await db.query(
    `update profile set is_active = true, approved_at = now(), role = '${rol}' where id = '${id}'`,
  )
  return id
}

const chequeador = await gente('cheq@ejemplo.test', 'chequeador')
const companero = await gente('comp@ejemplo.test', 'chequeador')
const deOtroAnden = await gente('otro@ejemplo.test', 'chequeador')

const { id: producto } = await one(
  `insert into product (sku, name, base_uom, base_code, variant)
   values ('61244.4', 'Galleta 24s', 'ST', '61244', '.4') returning id`,
)
await one(
  `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 24)
   returning id`,
  [producto],
)

const andenes = (await db.query(`select location_id, dock_door_id, anden from anden_de_recibo
  order by anden limit 2`)).rows
const uno = andenes[0]
const dos = andenes[1]

const turno = (persona, puerta) =>
  db.query(`insert into shift_assignment (profile_id, dock_door_id) values ($1, $2)`, [
    persona,
    puerta,
  ])

await turno(chequeador, uno.dock_door_id)
await turno(companero, uno.dock_door_id)
await turno(deOtroAnden, dos.dock_door_id)

const { id: doc } = await one(
  `insert into inbound_doc (pedido, status) values ('12345678', 'EXPECTED') returning id`,
)
await db.query(
  `insert into inbound_pallet (doc_id, pallet_code, product_id, qty_cases, lot, expiry_date)
   values ($1, '000100123456', $2, 48, 'L2601', '2027-04-24'),
          ($1, '000100123457', $2, 36, 'L2602', '2027-05-10')`,
  [doc, producto],
)

// ---------------------------------------------------------------------------------------
// Antes de bajar nada no hay nada que retomar
// ---------------------------------------------------------------------------------------

await como(chequeador)
check(
  (await one(`select ingreso_en_curso() as p`)).p === null,
  'con el camión sin empezar no hay nada abierto que devolver',
)

// ---------------------------------------------------------------------------------------
// El primer pallet deja dicho en qué andén se descarga
// ---------------------------------------------------------------------------------------

await one(
  `select * from recibir_del_documento('12345678', '000100123456', $1, null, 0::smallint)`,
  [uno.location_id],
)

const anotado = await one(`select anden from inbound_progress where id = $1`, [doc])
check(anotado?.anden === uno.anden, 'el andén se anota solo al recibir el primer pallet')

check(
  (await one(`select ingreso_en_curso() as p`)).p === '12345678',
  'y al volver a la pantalla el pedido sigue ahí, con lo que ya se bajó',
)

const lista = await db.query(
  `select pallet_code, received_at, destino from inbound_detail where doc_id = $1
   order by pallet_code`,
  [doc],
)
check(
  lista.rows[0].destino !== null,
  'la lista dice dónde queda el pallet que ya bajó: con eso el chequeador pregunta y comprueba',
)
check(
  lista.rows[1].received_at === null && lista.rows[1].destino === null,
  'y el que no ha bajado no tiene posición que enseñar, porque todavía no se le reservó ninguna',
)

// ---------------------------------------------------------------------------------------
// Del camión a la cola de guardar, y de ahí a quien está parado en ese andén
// ---------------------------------------------------------------------------------------

const tarea = await one(
  `select t.status, l.code as desde, d.code as hasta
   from task t
   join location l on l.id = t.from_location_id
   left join location d on d.id = t.to_location_id
   where t.type = 'PUTAWAY' and t.lpn_id = (select id from lpn where code = '000100123456')`,
)
check(tarea?.status === 'READY', 'recibir el pallet deja la tarea de guardar lista, sin más pasos')
check(tarea?.desde === `STG-${uno.anden}`, 'y la tarea sale del andén donde bajó el camión')
check(tarea?.hasta !== null, 'con el hueco ya escogido')

const deOtro = await gente('monta-otro@ejemplo.test', 'montacargista')
await turno(deOtro, dos.dock_door_id)
await como(deOtro)
check(
  (await one(`select id from claim_next_task(array['PUTAWAY']::task_type[])`)).id === null,
  'al montacarguista del otro andén no le cae: no va a cruzar la bodega a buscarla',
)

const delAnden = await gente('monta@ejemplo.test', 'montacargista')
await turno(delAnden, uno.dock_door_id)
await como(delAnden)
check(
  (await one(`select id from claim_next_task(array['PUTAWAY']::task_type[])`)).id !== null,
  'y al que está en ese andén le cae sola, sin que nadie se la reparta',
)

// ---------------------------------------------------------------------------------------
// El camión es del andén, no de la persona
// ---------------------------------------------------------------------------------------

await como(companero)
check(
  (await one(`select ingreso_en_curso() as p`)).p === '12345678',
  'el compañero del mismo andén retoma el mismo camión aunque no lo haya abierto él',
)

await como(deOtroAnden)
check(
  (await one(`select ingreso_en_curso() as p`)).p === null,
  'y al del otro andén no le aparece un camión que no es suyo',
)

// ---------------------------------------------------------------------------------------
// Cerrado el camión, deja de volver
// ---------------------------------------------------------------------------------------

await como(chequeador)
await one(
  `select * from recibir_del_documento('12345678', '000100123457', $1, null, 0::smallint)`,
  [uno.location_id],
)
check(
  (await one(`select ingreso_en_curso() as p`)).p === null,
  'el camión completo ya no vuelve: no hay nada a medias que retomar',
)

// ---------------------------------------------------------------------------------------
// El despacho, igual: el camión del andén donde está parada
// ---------------------------------------------------------------------------------------

const carga = await one(`select dock_door_id, anden from anden_de_carga order by anden limit 1`)
await db.query(`update shift_assignment set dock_door_id = $1 where profile_id = $2`, [
  carga.dock_door_id,
  chequeador,
])

const { id: camion } = await one(
  `insert into sales_order (code, customer, dock_door_id, status, released_at)
   values ('TAB-0001', 'Cliente', $1, 'RELEASED', now()) returning id`,
  [carga.dock_door_id],
)

check(
  (await one(`select despacho_en_curso() as id`)).id === camion,
  'el camión que se está cargando en su andén vuelve solo al entrar a Despacho',
)

await como(deOtroAnden)
check(
  (await one(`select despacho_en_curso() as id`)).id === null,
  'y no se le enseña a quien está en otro andén',
)

await como(chequeador)
await db.query(`update sales_order set status = 'SHIPPED', shipped_at = now() where id = $1`, [
  camion,
])
check(
  (await one(`select despacho_en_curso() as id`)).id === null,
  'el camión que ya salió tampoco vuelve',
)

// ---------------------------------------------------------------------------------------
// Sin andén puesto, lo propio: casi todos entran a trabajo sin elegir ninguno
// ---------------------------------------------------------------------------------------

const suelto = await gente('suelto@ejemplo.test', 'chequeador')
await db.query(`insert into shift_assignment (profile_id) values ($1)`, [suelto])

const { id: doc2 } = await one(
  `insert into inbound_doc (pedido, status) values ('87654321', 'EXPECTED') returning id`,
)
await db.query(
  `insert into inbound_pallet (doc_id, pallet_code, product_id, qty_cases, lot, expiry_date)
   values ($1, '000100987654', $2, 10, 'L2603', '2027-06-01'),
          ($1, '000100987655', $2, 10, 'L2604', '2027-06-02')`,
  [doc2, producto],
)

await como(suelto)
await one(
  `select * from recibir_del_documento('87654321', '000100987654', $1, null, 0::smallint)`,
  [uno.location_id],
)
check(
  (await one(`select ingreso_en_curso() as p`)).p === '87654321',
  'quien no tiene andén puesto retoma lo último que recibió él mismo',
)

const otraCarga = await one(`select dock_door_id from anden_de_carga order by anden desc limit 1`)
const { id: ajeno } = await one(
  `insert into sales_order (code, customer, dock_door_id, status)
   values ('TAB-0002', 'Cliente', $1, 'DRAFT') returning id`,
  [otraCarga.dock_door_id],
)
await db.query(`update sales_order set status = 'RELEASED', released_at = now() where id = $1`, [
  ajeno,
])
check(
  (await one(`select despacho_en_curso() as id`)).id === ajeno,
  'y el camión que abrió escaneando la hoja sigue siendo suyo aunque esté en otro andén',
)

// Y quien sí tiene andén ve el suyo primero, aunque haya abierto otro de paso.
await db.query(`update shift_assignment set dock_door_id = $1 where profile_id = $2`, [
  carga.dock_door_id,
  suelto,
])
const { id: delSuyo } = await one(
  `insert into sales_order (code, customer, dock_door_id, status, released_at)
   values ('TAB-0003', 'Cliente', $1, 'RELEASED', now() - interval '1 hour') returning id`,
  [carga.dock_door_id],
)
check(
  (await one(`select despacho_en_curso() as id`)).id === delSuyo,
  'el de su andén manda sobre el que abrió de paso en otro',
)

await db.close()
