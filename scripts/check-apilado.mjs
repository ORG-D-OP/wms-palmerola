import { bootDb, check } from './lib/boot-db.mjs'

/**
 * Cuantos pallets van uno sobre otro en el piso.
 *
 * Lo que se prueba es que el motor obedezca a la estiba del producto: que apile hasta donde
 * la bodega dijo y ni uno mas, que no apile nada de lo que no esta en la lista, y que en el
 * rack siga siendo un pallet por posicion, por apilable que sea el producto.
 */
const db = await bootDb()
const one = async (sql, params) => (await db.query(sql, params)).rows[0]

const { id: jefe } = await one(
  `insert into auth.users (email) values ('jefe@ejemplo.test') returning id`,
)
await db.query(`update profile set is_active = true, approved_at = now(), role = 'supervisor' where id = '${jefe}'`)
await db.query(`select set_config('request.jwt.claim.sub', '${jefe}', false)`)

const producto = async (sku, niveles) => {
  const { id } = await one(
    `insert into product (sku, name, base_uom) values ($1, $1, 'ST') returning id`,
    [sku],
  )
  await one(
    `insert into pallet_config (product_id, pallet_type_code, cases_per_layer, layers,
                                cases_per_pallet, allows_stacking, max_stack)
     values ($1, (select code from pallet_type limit 1), 10, 5, 50, $2, $3) returning id`,
    [id, niveles > 1, niveles],
  )
  return id
}

const apilable = await producto('AP-2', 2)
const suelto = await producto('AP-1', 1)

// De almacen y de alimento, que es lo que son estos productos de prueba: la zona F1 y los
// cuatro primeros carriles de abarroteria son del no alimento (migracion 0097).
const deAlmacen = `
  select l.id, l.code from location l
  join location_area lar on lar.location_id = l.id and lar.valid_to is null
  join area a on a.id = lar.area_id
  where a.code = 'ALMACEN' and coalesce(l.grupo, 'ALIMENTO') = 'ALIMENTO'`
const { id: piso, code: pisoCode } = await one(
  `${deAlmacen} and l.kind = 'floor_stack' order by l.code limit 1`,
)
const { id: rack } = await one(
  `${deAlmacen} and l.kind not in ('floor_stack', 'staging') order by l.code limit 1`,
)

const caben = async (location, product) =>
  Number((await one(`select pallets_que_caben($1, $2) as n`, [location, product])).n)

check(await caben(piso, apilable).then((n) => n === 2), 'en piso caben dos pallets del apilable')
check(await caben(piso, suelto).then((n) => n === 1), 'el que no se apila va solo')
check(await caben(rack, apilable).then((n) => n === 1), 'en rack es un pallet, apile o no apile')

const dejar = async (location, product, pallet) => {
  const { id: lpn } = await one(
    `insert into lpn (code, source) values ($1, 'INTERNO') returning id`,
    [pallet],
  )
  await one(
    `insert into stock (location_id, product_id, lpn_id, lot, qty_base)
     values ($1, $2, $3, 'L1', 100) returning id`,
    [location, product, lpn],
  )
}

await dejar(piso, apilable, 'PAL-A1')
check(await caben(piso, apilable).then((n) => n === 1), 'con un pallet encima queda sitio para uno')

const sugerida = await one(`select suggest_putaway_location($1, 'L1') as id`, [apilable])
check(sugerida.id === piso, 'el segundo pallet se manda encima del primero, no a otro hueco')

await dejar(piso, apilable, 'PAL-A2')
check(await caben(piso, apilable).then((n) => n === 0), 'dos pallets llenan la posicion')

const tercera = await one(`select suggest_putaway_location($1, 'L1') as id`, [apilable])
check(
  tercera.id !== null && tercera.id !== piso,
  'lleno el sitio, el tercer pallet se va a otra posicion',
)

const { id: otroPiso, code: otroCode } = await one(
  `${deAlmacen} and l.kind = 'floor_stack' and l.code <> $1 order by l.code limit 1`,
  [pisoCode],
)
await dejar(otroPiso, suelto, 'PAL-B1')
check(await caben(otroPiso, suelto).then((n) => n === 0), 'al que no se apila no le suben otro')

const paraSuelto = await one(`select suggest_putaway_location($1, 'L1') as id`, [suelto])
check(
  paraSuelto.id !== otroPiso,
  `el segundo pallet del que no se apila no vuelve a ${otroCode}`,
)

const niveles = await one(
  `select count(*)::int as n from apilado_en_piso where sku = 'AP-2'`,
)
check(niveles.n === 1, 'la vista de apilado muestra solo lo que se apila')

/*
  Y que el mapa se entere, que es lo que faltaba: el dato estaba desde la 0047 y el tablero
  pintaba un pallet donde hay dos. `planta()` manda la pila de cada posicion de piso y de ahi
  salen el tono del cuadro, las rayas de los pallets y la pila del isometrico.
*/
const pilas = (await one(`select planta()->'pilas' as pilas`)).pilas ?? {}

check(
  pilas[pisoCode]?.hay === 2 && pilas[pisoCode]?.caben === 2,
  `la planta dice que en ${pisoCode} hay 2 pallets de 2 que caben`,
)
check(
  pilas[otroCode]?.hay === 1 && pilas[otroCode]?.caben === 1,
  'y que al que no se apila le cabe uno y ese uno esta puesto',
)

await dejar(rack, apilable, 'PAL-R1')
const conRack = (await one(`select planta()->'pilas' as pilas`)).pilas ?? {}
check(
  Object.keys(conRack).every((code) => !code.startsWith('R-')),
  'la pila es cosa del piso: el rack no entra, que ahi la pila es la estanteria',
)

// Lo que sale al tocar el cuadro: cuantos caben, para poder decir «2 de 2 pallets apilados».
const cuadro = (await db.query(`select * from que_hay_en($1)`, [pisoCode])).rows
check(cuadro.length === 2, `tocar ${pisoCode} trae los dos pallets que tiene encima`)
check(
  cuadro.every((f) => f.caben === 2 && f.guarda === true && f.apartada === false),
  'y cada uno dice que caben dos, que guarda producto y que no esta apartada',
)
