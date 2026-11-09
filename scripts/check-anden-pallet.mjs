import { bootDb, check } from './lib/boot-db.mjs'

/**
 * Dos reglas de la bodega que el modelo tenia al reves. Lo que aqui se fija: que la cola de
 * guardado respete el anden donde el jefe de bodega paro a la persona, que el jefe los pueda
 * mover, y que un pedido de pallets enteros se surta de almacen sin partir ninguno mientras
 * las cajas sueltas siguen saliendo de picking.
 */
const db = await bootDb()
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const falla = async (sql, params) =>
  db.query(sql, params).then(
    () => null,
    (e) => e.message,
  )

const { id: jefe } = await one(
  `insert into auth.users (email) values ('jefe-anden@ejemplo.test') returning id`,
)
const { id: uno } = await one(
  `insert into auth.users (email) values ('aux-anden-1@ejemplo.test') returning id`,
)
const { id: dos } = await one(
  `insert into auth.users (email) values ('aux-anden-2@ejemplo.test') returning id`,
)
await db.query(`update profile set role = 'supervisor' where id = '${jefe}'`)
await db.query(`update profile set role = 'auxiliar' where id in ('${uno}', '${dos}')`)
const como = (id) => db.query(`select set_config('request.jwt.claim.sub', '${id}', false)`)

await como(jefe)

const { id: producto } = await one(
  `insert into product (sku, name, base_uom, requires_fefo)
   values ('PAL-1', 'Producto de pallet entero', 'ST', true) returning id`,
)
const { id: caja } = await one(
  `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 10)
   returning id`,
  [producto],
)

const andenes = await db.query(`select id, code from dock_door order by code limit 2`)
const [andenA, andenB] = andenes.rows
const stgA = await one(`select id from location where code = $1`, [`STG-${andenA.code}`])
const stgB = await one(`select id from location where code = $1`, [`STG-${andenB.code}`])

// --- el reparto del jefe -----------------------------------------------------------------

await como(uno)
const sinPermiso = await falla(`select asignar_anden($1, $2)`, [dos, andenA.code])
check(sinPermiso?.includes('jefe de bodega'), 'un auxiliar no reparte gente entre andenes')

await como(jefe)
const sinTurno = await falla(`select asignar_anden($1, $2)`, [uno, andenA.code])
check(sinTurno?.includes('no está trabajando'), 'no se reparte a quien no entro a trabajo')

await como(uno)
await db.query(`select iniciar_turno()`)
await como(dos)
await db.query(`select iniciar_turno()`)

await como(jefe)
const inventado = await falla(`select asignar_anden($1, 'AND-X-9')`, [uno])
check(inventado?.includes('ningún andén'), 'un anden que no existe se rechaza')

await db.query(`select asignar_anden($1, $2)`, [uno, andenA.code])
await db.query(`select asignar_anden($1, $2)`, [dos, andenB.code])

const reparto = await db.query(`select full_name, anden from disponibles order by anden`)
check(reparto.rows.length === 2, 'el jefe ve a los dos en su lista')
check(reparto.rows[0].anden === andenA.code, 'con el anden donde los paro')

const mio = await one(`select anden from mi_trabajo where profile_id = $1`, [uno])
check(mio.anden === andenA.code, 'y cada persona ve en que anden la pusieron')

// --- la cola respeta el anden ------------------------------------------------------------

const tarea = async (tipo, desde, hacia) =>
  one(
    `insert into task (type, product_id, qty_base, from_location_id, to_location_id, status, priority)
     values ($1, $2, 100, $3, $4, 'READY', 100) returning id`,
    [tipo, producto, desde, hacia],
  )

const { id: posicion } = await one(
  `select id from location where level = 0 and usage_code = 'PRODUCTO' order by code limit 1`,
)

const delA = await tarea('PUTAWAY', stgA.id, posicion)

await como(dos)
const nada = await one(`select * from claim_next_task(array['PUTAWAY']::task_type[])`)
check(
  nada.id === null,
  'a quien esta en el anden 2 no le cae un pallet del anden 1, al otro extremo de la nave',
)

await como(uno)
const tomada = await one(`select * from claim_next_task(array['PUTAWAY']::task_type[])`)
check(tomada.id === delA.id, 'y a quien esta en el anden 1, si')

// Reacomodar no empieza ni termina en un anden: eso le cae a cualquiera.
const { id: otraPosicion } = await one(
  `select id from location where level = 0 and usage_code = 'PRODUCTO' order by code offset 1 limit 1`,
)
const interna = await tarea('MOVE', posicion, otraPosicion)
await como(dos)
const movida = await one(`select * from claim_next_task(array['MOVE']::task_type[])`)
check(movida.id === interna.id, 'una tarea sin anden le cae a cualquiera')

// El jefe lo mueve de anden y la cola cambia con el.
const delB = await tarea('PUTAWAY', stgB.id, posicion)
await como(uno)
const noLeToca = await one(`select * from claim_next_task(array['PUTAWAY']::task_type[])`)
check(noLeToca.id === null, 'mientras siga en el anden 1 no le toca lo del anden 2')

await como(jefe)
await db.query(`select asignar_anden($1, $2)`, [uno, andenB.code])
await como(uno)
const ahoraSi = await one(`select * from claim_next_task(array['PUTAWAY']::task_type[])`)
check(ahoraSi.id === delB.id, 'el jefe lo mueve de anden y la cola se mueve con el')

await como(jefe)
await db.query(`select asignar_anden($1, null)`, [dos])
const suelto = await one(`select anden from disponibles where id = $1`, [dos])
check(suelto.anden === null, 'y lo puede soltar para que atienda toda la bodega')

// --- pallet entero de almacen, cajas de picking -------------------------------------------

await como(jefe)

const { id: areaPicking } = await one(`select id from area where code = 'PICKING'`)
const { id: pickLoc } = await one(
  `select id from location where level = 0 and usage_code = 'PRODUCTO' order by code offset 5 limit 1`,
)
await db.query(`update location_area set valid_to = now() where location_id = $1 and valid_to is null`, [pickLoc])
await db.query(`insert into location_area (location_id, area_id) values ($1, $2)`, [pickLoc, areaPicking])

// Tres pallets de 480 unidades en almacen y 200 sueltas en picking, con FEFO escalonado.
const rack = await db.query(
  `select id, code from location where level > 0 and usage_code = 'PRODUCTO' order by code limit 3`,
)
const pallets = [
  { loc: rack.rows[0], lote: 'L-1', vence: '2027-01-31' },
  { loc: rack.rows[1], lote: 'L-2', vence: '2027-02-28' },
  { loc: rack.rows[2], lote: 'L-3', vence: '2027-03-31' },
]
for (const [i, p] of pallets.entries()) {
  const { id: lpn } = await one(
    `insert into lpn (code, level, source) values ($1, 'PALLET', 'NEST') returning id`,
    [`PAL-ENTERO-${i}`],
  )
  await db.query(
    `select post_movement('RECEIPT', $1, 480, null, $2, $3, $4, $5, null, null, $6)`,
    [producto, p.loc.id, lpn, p.lote, p.vence, caja],
  )
}
await db.query(
  `select post_movement('RECEIPT', $1, 200, null, $2, null, 'L-PICK', '2027-06-30', null, null, $3)`,
  [producto, pickLoc, caja],
)

let nSo = 0
const pedir = async (cantidad) => {
  const { id } = await one(
    `insert into sales_order (code, dock_door_id, status) values ($1, $2, 'DRAFT') returning id`,
    [`SO-${++nSo}`, andenA.id],
  )
  await db.query(
    `insert into order_line (order_id, line_no, product_id, qty_base, packaging_level_id)
     values ($1, 1, $2, $3, $4)`,
    [id, producto, cantidad, caja],
  )
  await db.query(`select release_order($1)`, [id])
  return db.query(
    `select t.qty_base, t.from_location_id, l.code, a.code as area
     from task t
     join location l on l.id = t.from_location_id
     join location_area lar on lar.location_id = l.id and lar.valid_to is null
     join area a on a.id = lar.area_id
     join allocation al on al.task_id = t.id
     join order_line ol on ol.id = al.order_line_id
     where ol.order_id = $1
     order by t.qty_base desc, l.code`,
    [id],
  )
}

// Dos pallets justos: ni una caja de picking.
const dosPallets = await pedir(960)
check(dosPallets.rows.length === 2, 'un pedido de dos pallets se surte con dos tareas, no con cien')
check(
  dosPallets.rows.every((r) => Number(r.qty_base) === 480 && r.area === 'ALMACEN'),
  'los pallets enteros salen de almacen, completos y sin partir',
)
check(
  dosPallets.rows[0].code === pallets[0].loc.code,
  'y en orden FEFO: primero el lote que vence antes',
)

// Un pallet y pico: el pallet de almacen, el resto de picking.
const mixto = await pedir(530)
check(mixto.rows.length === 2, 'un pallet y medio se surte con dos tareas')
check(
  Number(mixto.rows[0].qty_base) === 480 && mixto.rows[0].area === 'ALMACEN',
  'el pallet entero de almacen',
)
check(
  Number(mixto.rows[1].qty_base) === 50 && mixto.rows[1].area === 'PICKING',
  'y las 50 unidades sueltas de picking, que es para lo que existe',
)

// Menos de un pallet: no se toca almacen mientras picking alcance.
const suelto2 = await pedir(100)
check(suelto2.rows.length === 1, 'un pedido chico se surte de un solo lugar')
check(suelto2.rows[0].area === 'PICKING', 'y ese lugar es picking, sin bajar ningun pallet del rack')

// Lo que picking ya no aguanta cae a almacen: mejor partir un pallet que no despachar.
// Picking quedo en 50 unidades, y entra un pallet mas al rack para que haya de donde partir.
const { id: lpnUltimo } = await one(
  `insert into lpn (code, level, source) values ('PAL-ENTERO-3', 'PALLET', 'NEST') returning id`,
)
await db.query(
  `select post_movement('RECEIPT', $1, 480, null, $2, $3, 'L-4', '2027-04-30', null, null, $4)`,
  [producto, rack.rows[0].id, lpnUltimo, caja],
)

const resto = await pedir(100)
check(
  resto.rows.some((r) => r.area === 'ALMACEN'),
  'si picking se queda corto, se parte un pallet antes que dejar el camion sin producto',
)

// --- el pallet entero se confirma con su matricula ---------------------------------------

// Un pedido limpio de un pallet para poder surtirlo de verdad.
const { id: ultimoLpn } = await one(
  `insert into lpn (code, level, source) values ('PAL-SURTIR', 'PALLET', 'NEST') returning id`,
)
const { id: posRack } = await one(
  `select id from location where level > 0 and usage_code = 'PRODUCTO' order by code offset 10 limit 1`,
)
await db.query(
  `select post_movement('RECEIPT', $1, 480, null, $2, $3, 'L-9', '2028-01-31', null, null, $4)`,
  [producto, posRack, ultimoLpn, caja],
)

const { id: pedidoEntero } = await one(
  `insert into sales_order (code, dock_door_id, status) values ('SO-ENTERO', $1, 'DRAFT')
   returning id`,
  [andenA.id],
)
await db.query(
  `insert into order_line (order_id, line_no, product_id, qty_base, packaging_level_id)
   values ($1, 1, $2, 480, $3)`,
  [pedidoEntero, producto, caja],
)
await db.query(`select release_order($1)`, [pedidoEntero])

const { id: tareaEntera, from_location_id: desdeRack } = await one(
  `select t.id, t.from_location_id from task t
   join allocation a on a.task_id = t.id
   join order_line ol on ol.id = a.order_line_id
   where ol.order_id = $1`,
  [pedidoEntero],
)
check(desdeRack === posRack, 'el pallet del rack es el que se aparta para el pedido entero')

await como(jefe)
await db.query(`select iniciar_turno()`)
await db.query(
  `update task set status = 'ASSIGNED', assigned_to = $1 where id = $2`,
  [jefe, tareaEntera],
)
const { code: codigoRack } = await one(`select code from location where id = $1`, [posRack])
await db.query(`select start_pick($1, $2)`, [tareaEntera, codigoRack])

const ajeno = await falla(`select * from complete_pick($1, 'PAL-ENTERO-0', 480)`, [tareaEntera])
check(ajeno !== null, 'la matricula de otro pallet no sirve de prueba')

const surtido = await one(`select * from complete_pick($1, 'PAL-SURTIR', 480)`, [tareaEntera])
check(
  Number(surtido.surtido) === 480,
  'la matricula del pallet confirma el surtido: no hay que romper el emplayado para leer una caja',
)

const quedaEnRack = await one(
  `select coalesce(sum(qty_base), 0) as hay from stock where location_id = $1`,
  [posRack],
)
check(Number(quedaEnRack.hay) === 0, 'y la posicion del rack queda vacia')

await db.close()
