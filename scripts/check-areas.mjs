import { bootDb, check } from './lib/boot-db.mjs'

/**
 * Las areas y los usos son datos: el jefe los declara y el motor de ubicacion obedece.
 * Lo que se prueba aqui es justo eso, que obedezca: que no mande un pallet a picking, ni
 * a una posicion de corrugado, ni a un nivel al que el equipo no llega.
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
const { id: auxiliar } = await one(
  `insert into auth.users (email) values ('aux@ejemplo.test') returning id`,
)
await db.query(`update profile set is_active = true, approved_at = now(), role = 'supervisor' where id = '${jefe}'`)
await db.query(`update profile set is_active = true, approved_at = now(), role = 'auxiliar' where id = '${auxiliar}'`)
const como = (id) => db.query(`select set_config('request.jwt.claim.sub', '${id}', false)`)

const { id: producto } = await one(
  `insert into product (sku, name, base_uom) values ('A-1', 'Producto', 'ST') returning id`,
)
const { id: caja } = await one(
  `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 24)
   returning id`,
  [producto],
)

// ---------------------------------------------------------------------------------------
// Toda posicion nace en un area
// ---------------------------------------------------------------------------------------

const almacen = await one(`select total from area_occupancy where code = 'ALMACEN'`)
check(almacen.total === 5581, `el almacen arranca con las 5,581 posiciones (${almacen.total})`)

const picking = await one(`select total from area_occupancy where code = 'PICKING'`)
check(picking.total === 0, 'el picking arranca vacio: nadie sabe todavia cual va a ser')

const { id: carril } = await one(`select lane_id as id from location where code = 'F1-001-01'`)
await one(
  `insert into location (lane_id, code, barcode, kind) values ($1, 'F1-999-99', 'F1-999-99', 'floor_stack')
   returning id`,
  [carril],
)
const nacida = await one(`select code from area_de((select id from location where code = 'F1-999-99'))`)
check(nacida?.code === 'ALMACEN', 'una posicion nueva nace en un area, no invisible')
await db.query(`delete from location_area where location_id =
  (select id from location where code = 'F1-999-99')`)
await db.query(`delete from location where code = 'F1-999-99'`)

// ---------------------------------------------------------------------------------------
// Quien puede cambiarlas
// ---------------------------------------------------------------------------------------

await como(auxiliar)
const ajeno = await fails(`select reasignar_area_por_codigo('F1-001-01', 'PICKING')`)
check(ajeno?.includes('Solo el jefe de bodega'), 'un auxiliar no mueve las areas')

await como(jefe)
const corto = await fails(`select reasignar_area_por_codigo('F', 'PICKING')`)
check(
  corto?.includes('tres caracteres'),
  'un patron de una letra no se lleva media bodega por descuido',
)

const vacio = await fails(`select reasignar_area_por_codigo('ZZZ-000', 'PICKING')`)
check(vacio?.includes('Ninguna posición'), 'un patron que no agarra nada avisa')

// ---------------------------------------------------------------------------------------
// El rango por criterios: lo que el prefijo del codigo no sabe decir
// ---------------------------------------------------------------------------------------

const codigos = async (sql, params) =>
  (await db.query(`select code from location where id = any(${sql}) order by code`, params)).rows.map(
    (r) => r.code,
  )

const sinNada = await fails(`select posiciones_donde()`)
check(sinNada?.includes('al menos una cosa'), 'sin ningun criterio no se agarra la bodega entera por descuido')

// «El piso bajo de los racks»: el nivel va en medio del codigo (R-ABA-L01-B01-N1-P1), asi que
// esto es justo lo que ningun prefijo podia agarrar.
const pisoBajo = await codigos(`posiciones_donde(null, 'rack', 1)`)
check(pisoBajo.length > 0, 'el piso bajo de los racks se agarra por zona y nivel')
check(
  pisoBajo.every((c) => c.includes('-N1-')),
  'y solo trae el nivel 1, ni uno de los de arriba',
)
check(
  new Set(pisoBajo.map((c) => c.slice(0, 5))).size === 2,
  'cruzando las dos zonas de rack de un solo enunciado',
)

const todoPiso = await codigos(`posiciones_donde(null, 'floor')`)
const zonasPiso = new Set(todoPiso.map((c) => c.slice(0, 2)))
check(zonasPiso.size === 7, `«todo el piso» son las siete zonas en un enunciado (${zonasPiso.size})`)

const unaZona = await codigos(`posiciones_donde(null, 'F1')`)
check(
  unaZona.length > 0 && unaZona.every((c) => c.startsWith('F1-')),
  'y una zona sola se dice por su codigo, igual que su clase',
)

const cruzado = await codigos(`posiciones_donde('R-ABA', 'rack', 1)`)
check(
  cruzado.length > 0 && cruzado.every((c) => c.startsWith('R-ABA') && c.includes('-N1-')),
  'los criterios se cruzan: el piso bajo de abarrotes y nada mas',
)

const inventada = await fails(`select posiciones_donde(null, 'sotano')`)
check(
  inventada?.includes('No hay zona ni clase'),
  'una zona que no existe avisa, en vez de devolver la bodega entera',
)

const nivelAjeno = await fails(`select posiciones_donde(null, 'floor', 3)`)
check(nivelAjeno?.includes('Ninguna posición'), 'el piso no tiene nivel 3, y lo dice')

const cortoCriterios = await fails(`select posiciones_donde('F')`)
check(cortoCriterios?.includes('tres caracteres'), 'el codigo sigue exigiendo tres caracteres')

// «Las lineas de la orilla» no es un rango, es una lista: catorce lineas sueltas. Se enumeran.
const orilla = await codigos(`posiciones_donde('F1-001, F1-025, F5-014')`)
check(
  orilla.length > 0 && new Set(orilla.map((c) => c.slice(0, 6))).size === 3,
  'varios codigos separados por coma son un solo rango',
)
check(
  orilla.every((c) => ['F1-001', 'F1-025', 'F5-014'].includes(c.slice(0, 6))),
  'y no se cuela ninguna linea que no se pidio',
)

const unoCorto = await fails(`select posiciones_donde('F1-001, F')`)
check(
  unoCorto?.includes('tres caracteres'),
  'si uno de la lista viene corto se rechaza la lista entera, no se ignora',
)

// ---------------------------------------------------------------------------------------
// El motor obedece el area, el uso y el alcance
// ---------------------------------------------------------------------------------------

const primera = await one(`select suggest_putaway_location($1) as id`, [producto])
const nombre = await one(`select code from location where id = $1`, [primera.id])
check(nombre?.code === 'F1-001-01', `sin nada guardado la primera sugerencia es el piso (${nombre?.code})`)

await one(`select reasignar_area_por_codigo('F1-001-01', 'PICKING')`)
const segunda = await one(
  `select code from location where id = suggest_putaway_location($1)`,
  [producto],
)
check(segunda?.code === 'F1-001-02', 'un pallet completo no se manda a picking')

const movidas = await one(`select reasignar_uso_por_codigo('F1-001-02', 'CORRUGADO') as n`)
check(movidas.n === 1, 'el uso se cambia por rango de codigo')
const tercera = await one(
  `select code from location where id = suggest_putaway_location($1)`,
  [producto],
)
check(tercera?.code === 'F1-001-03', 'una posicion de corrugado no recibe producto')

// Sacar el piso del almacen deja solo rack: es el escenario del montacarguista.
for (const bloque of ['F1-', 'F2-', 'F3-', 'F4-', 'F5-', 'F6-', 'F7-']) {
  await one(`select reasignar_area_por_codigo($1, 'PICKING')`, [bloque])
}
const soloPiso = await one(
  `select suggest_putaway_location($1, null, null, 0::smallint) as id`,
  [producto],
)
check(soloPiso.id === null, 'quien solo alcanza el piso no recibe una posicion de rack')

const enRack = await one(
  `select code, level from location where id = suggest_putaway_location($1)`,
  [producto],
)
check(enRack?.code?.startsWith('R-'), `con el piso fuera, la sugerencia es rack (${enRack?.code})`)

// ---------------------------------------------------------------------------------------
// El uso no se cambia con producto encima
// ---------------------------------------------------------------------------------------

const { id: anden } = await one(`select id from location where code = 'STG-AND-N-01'`)
await one(`select receive_pallet('PAL-A1', $1, $2, 10::numeric, $3, null, null, 'a-1')`, [
  producto,
  caja,
  anden,
])
const conPallet = await one(
  `select l.code from location l join stock s on s.location_id = l.id where s.qty_base > 0 limit 1`,
)
const ocupada = await fails(`select reasignar_uso_por_codigo($1, 'RAMPLA')`, [conPallet.code])
check(
  ocupada?.includes('con producto o apartadas'),
  'no se declara «aqui va rampla» una posicion con un pallet dentro',
)

// El mapa dibuja la planta de la bodega, asi que el anden de descarga no sale en el: lo
// que sale es la posicion donde quedo el pallet guardado.
const anden_mapa = await one(`select count(*)::int as n from posicion_estado where code like 'STG-%'`)
check(anden_mapa.n === 0, 'el anden no es parte del plano de la bodega')

const destino = await one(`select id, code from location where code = 'R-ABA-L02-B03-N1-P1'`)
await one(
  `select post_movement('RECEIPT'::movement_type, $1::uuid, 48::numeric, null, $2::uuid, null,
     'L2601'::text, '2027-06-30'::date)`,
  [producto, destino.id],
)
const pintar = await one(`select estado from posicion_estado where code = $1`, [destino.code])
check(pintar?.estado === 'OCUPADA', 'el mapa ve ocupada la posicion exacta, no la zona')

const vecina = await one(
  `select count(*)::int as n from posicion_estado where code like 'R-ABA-L02-B03-%' and code <> $1`,
  [destino.code],
)
check(vecina.n === 0, 'un pallet en el nivel 1 no pinta ocupados los otros cinco niveles')

const otroUso = await one(`select estado from posicion_estado where code = 'F1-001-02'`)
check(otroUso?.estado === 'OTRO_USO', 'la posicion de corrugado se pinta distinta')

// ---------------------------------------------------------------------------------------
// Redibujar el picking con la bodega llena, que es el caso de cada semana
// ---------------------------------------------------------------------------------------
// La planimetria, el ABC y la distribucion cambian seguido, asi que el picking se va a mover
// con producto adentro. Mover de area **no** se bloquea por eso —a diferencia de cambiar el
// uso—, y el saldo no se toca: lo unico que cambia es de donde puede sacar el motor.

const movidoConPallet = await one(`select reasignar_area_donde('PICKING', null, 'rack', 1) as n`)
check(movidoConPallet.n > 0, 'el picking se redibuja aunque haya producto encima')

const quedo = await one(`select area_code, ocupada from posicion_detalle where code = $1`, [
  destino.code,
])
check(
  quedo.area_code === 'PICKING' && quedo.ocupada === true,
  'la posicion con el pallet quedo en picking, y el pallet sigue ahi',
)

const tarea = await one(`select id from task limit 1`)
await db.query(`update location set reserved_by_task_id = $2 where id = $1`, [
  destino.id,
  tarea.id,
])
const conApartada = await one(`select reasignar_area_donde('ALMACEN', null, 'rack', 1) as n`)
check(
  conApartada.n > 0,
  'y se devuelve aunque alguna este apartada: si no, el cambio semanal nunca pasaria',
)
await db.query(`update location set reserved_by_task_id = null where id = $1`, [destino.id])

const intacto = await one(`select sum(qty_base)::int as q from stock where location_id = $1`, [
  destino.id,
])
check(intacto.q === 48, 'el saldo no se movio en ninguno de los dos cambios')

const historia = await one(
  `select count(*)::int as n, count(valid_to)::int as cerradas
     from location_area where location_id = $1`,
  [destino.id],
)
check(
  historia.n === 3 && historia.cerradas === 2,
  `y queda la historia de los dos cambios, no solo el ultimo (${historia.n}/${historia.cerradas})`,
)

await db.close()
