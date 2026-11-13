import { bootDb, check } from './lib/boot-db.mjs'

/**
 * El camion que llega sin que nadie lo anunciara. Lo que aqui se fija: que la bodega pueda
 * abrir el ingreso sin pedido, que el documento se vaya construyendo con lo que de verdad
 * baja del camion, que un pallet sin etiqueta legible igual se pueda recibir, y que una vez
 * cerrada el acta no se le pueda agregar nada mas.
 */
const db = await bootDb()
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const falla = async (sql, params) =>
  db.query(sql, params).then(
    () => null,
    (e) => e.message,
  )

const { id: jefe } = await one(
  `insert into auth.users (email) values ('chequeador@ejemplo.test') returning id`,
)
const { id: operario } = await one(
  `insert into auth.users (email) values ('aux2@ejemplo.test') returning id`,
)
await db.query(`update profile set is_active = true, approved_at = now(), role = 'chequeador' where id = '${jefe}'`)
await db.query(`update profile set is_active = true, approved_at = now(), role = 'auxiliar' where id = '${operario}'`)
const como = (id) => db.query(`select set_config('request.jwt.claim.sub', '${id}', false)`)

// --- el maestro minimo ------------------------------------------------------------------

await como(jefe)

const { id: galleta } = await one(
  `insert into product (sku, name, base_uom, base_code, requires_fefo)
   values ('61244C4', 'Galleta carton', 'ST', '61244', true) returning id`,
)
const { id: cajaGalleta } = await one(
  `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 24)
   returning id`,
  [galleta],
)
await one(`insert into barcode (packaging_level_id, code, symbology) values ($1, '70123456789015', 'GTIN14')`, [
  cajaGalleta,
])

// El mismo producto en plastico: comparte el DUN-14, que es justo el caso que no se adivina.
const { id: plastico } = await one(
  `insert into product (sku, name, base_uom, base_code) values ('61244P4', 'Galleta plastico', 'ST', '61244')
   returning id`,
)
const { id: cajaPlastico } = await one(
  `insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 24)
   returning id`,
  [plastico],
)

await one(
  `insert into product (sku, name, base_uom) values ('SIN-CASE', 'Producto sin corrugado', 'ST')
   returning id`,
)

const { id: anden } = await one(`select id from location where code like 'STG-AND-N-%' limit 1`)

// --- abrir -------------------------------------------------------------------------------

await como(operario)
const sinPermiso = await falla(`select abrir_ingreso_sin_aviso('Planta Choloma')`)
check(sinPermiso?.includes('permiso'), 'un auxiliar no abre un ingreso sin aviso')

await como(jefe)
const doc = await one(
  `select * from abrir_ingreso_sin_aviso('Planta Choloma', 'Avisaron por correo')`,
)
check(doc.sin_aviso === true, 'el documento queda marcado como abierto por la bodega')
check(doc.pedido.startsWith('SA-'), 'el codigo se ve distinto a un pedido de SAP')
check(doc.status === 'ARRIVED', 'arranca en ARRIVED: el camion esta ahi pero no se ha bajado nada')
check(doc.nota === 'Avisaron por correo', 'la nota del chequeador queda guardada')

const otro = await one(`select * from abrir_ingreso_sin_aviso(null)`)
check(otro.pedido !== doc.pedido, 'dos ingresos del mismo dia no chocan de codigo')

// --- que producto tengo en la mano -------------------------------------------------------

const porSku = await one(`select * from producto_para_recibir('61244C4')`)
check(porSku.product_id === galleta, 'el SKU resuelve el producto')
check(porSku.case_id === cajaGalleta, 'y trae el corrugado para poder contar cajas')
check(porSku.requires_fefo === true, 'y si exige vencimiento, lo dice')

const porCodigo = await one(`select * from producto_para_recibir('70123456789015')`)
check(porCodigo.product_id === galleta, 'el codigo de barras tambien resuelve')

await one(`insert into barcode (packaging_level_id, code, symbology) values ($1, '70123456789015', 'GTIN14')`, [
  cajaPlastico,
])
const ambiguo = await falla(`select * from producto_para_recibir('70123456789015')`)
check(ambiguo?.includes('varios productos'), 'un DUN-14 compartido no se adivina: pide el SKU')

const inventado = await falla(`select * from producto_para_recibir('99999999999999')`)
check(inventado?.includes('No existe'), 'un codigo que no esta en el maestro se rechaza')

// --- recibir -----------------------------------------------------------------------------

const sinCajas = await falla(
  `select * from recibir_sin_aviso($1, '61244C4', 0, $2, null, '2027-01-31')`,
  [doc.pedido, anden],
)
check(sinCajas?.includes('cuántas cajas'), 'no se recibe un pallet sin decir cuantas cajas trae')

const sinVencimiento = await falla(
  `select * from recibir_sin_aviso($1, '61244C4', 10, $2, 'L-9')`,
  [doc.pedido, anden],
)
check(sinVencimiento?.includes('FEFO'), 'y el vencimiento también, porque de ahí sale el FEFO')

const faltaCorrugado = await falla(
  `select * from recibir_sin_aviso($1, 'SIN-CASE', 10, $2, 'L-9', '2027-01-31')`,
  [doc.pedido, anden],
)
check(
  faltaCorrugado?.includes('corrugado'),
  'un producto sin corrugado en el maestro no se puede recibir por cajas',
)

const conEtiqueta = await one(
  `select * from recibir_sin_aviso($1, '61244C4', 40, $2, 'L-77', '2027-01-31', 'PAL-NEST-001')`,
  [doc.pedido, anden],
)
check(conEtiqueta.lpn_code === 'PAL-NEST-001', 'si el pallet trae etiqueta legible, esa es su matricula')
check(conEtiqueta.sku === '61244C4', 'y queda claro que producto se recibio')
check(Number(conEtiqueta.cases) === 40, 'con las cajas que el chequeador contó')
check(conEtiqueta.recibidos === 1 && conEtiqueta.pallets === 1, 'el acta va en un pallet')

const sinEtiqueta = await one(
  `select * from recibir_sin_aviso($1, '61244C4', 36, $2, null, '2027-02-28')`,
  [doc.pedido, anden],
)
check(
  sinEtiqueta.lpn_code.startsWith('WMS-'),
  'un pallet sin etiqueta legible igual se recibe: el WMS le pone matricula',
)
check(sinEtiqueta.recibidos === 2, 'y el acta va en dos')

const procedencia = await one(`select source from lpn where code = $1`, [sinEtiqueta.lpn_code])
check(
  procedencia.source === 'PROVISIONAL',
  'y esa matricula queda marcada como provisional, no como venida de planta',
)
const dePlanta = await one(`select source from lpn where code = 'PAL-NEST-001'`)
check(dePlanta.source === 'NEST', 'mientras la etiqueta de planta sigue siendo de planta')

const loteVacio = await one(`select lot from inbound_pallet where pallet_code = $1`, [
  sinEtiqueta.lpn_code,
])
check(loteVacio.lot === null, 'el lote va vacio cuando no viene impreso, no inventado')

const estado = await one(`select status from inbound_doc where id = $1`, [doc.id])
check(estado.status === 'RECEIVING', 'con el primer pallet el ingreso pasa a RECEIVING')

const lineas = await one(`select count(*)::int as n from inbound_line where doc_id = $1`, [doc.id])
check(lineas.n === 2, 'el documento se construye recibiendo: una linea por pallet bajado')

const saldo = await one(
  `select sum(qty_base) as unidades from stock where location_id = $1 and product_id = $2`,
  [anden, galleta],
)
// 76 cajas de 24 unidades: el saldo se lleva en unidades base, la conversion la hace
// `receive_pallet`. Lo que el chequeador cuenta son cajas; lo que el sistema guarda, unidades.
check(Number(saldo.unidades) === 1824, 'las 76 cajas quedan en el anden, listas para guardar')

const tareas = await one(
  `select count(*)::int as n from task where type = 'PUTAWAY' and product_id = $1`,
  [galleta],
)
check(tareas.n === 2, 'y cada pallet deja su tarea de guardado')

const repetida = await falla(
  `select * from recibir_sin_aviso($1, '61244C4', 40, $2, 'L-77', '2027-01-31', 'PAL-NEST-001')`,
  [doc.pedido, anden],
)
check(repetida !== null, 'la misma matricula no entra dos veces')

// --- un ingreso con documento no se recibe a ciegas --------------------------------------

const { pedido: conDocumento } = await one(
  `insert into inbound_doc (pedido) values ('60213772') returning pedido`,
)
const mezclado = await falla(
  `select * from recibir_sin_aviso($1, '61244C4', 10, $2, 'L-9', '2027-01-31')`,
  [conDocumento, anden],
)
check(
  mezclado?.includes('tiene documento'),
  'un ingreso anunciado se recibe contra su lista, no a ciegas',
)

// --- cerrar el acta ----------------------------------------------------------------------

const enProgreso = await one(
  `select sin_aviso, nota from inbound_progress where id = $1`,
  [doc.id],
)
check(
  enProgreso.sin_aviso === true,
  'la pantalla sabe de una sola consulta que el ingreso es a ciegas',
)
check(enProgreso.nota === 'Avisaron por correo', 'y por qué lo abrieron')

const abiertos = await db.query(`select pedido from ingreso_abierto order by pedido`)
check(
  abiertos.rows.some((r) => r.pedido === doc.pedido),
  'mientras esta abierto aparece en la lista del chequeador',
)
check(
  !abiertos.rows.some((r) => r.pedido === conDocumento),
  'y los que vienen con documento no se mezclan en esa lista',
)

await como(operario)
const cierreSinPermiso = await falla(`select cerrar_ingreso_sin_aviso($1)`, [doc.pedido])
check(cierreSinPermiso?.includes('permiso'), 'un auxiliar no cierra el acta')

await como(jefe)
const noAplica = await falla(`select cerrar_ingreso_sin_aviso($1)`, [conDocumento])
check(
  noAplica?.includes('último pallet'),
  'los ingresos con documento se cierran solos, no a mano',
)

const cerrado = await one(`select * from cerrar_ingreso_sin_aviso($1)`, [doc.pedido])
check(cerrado.status === 'CLOSED', 'el chequeador cierra el acta')

const despues = await falla(
  `select * from recibir_sin_aviso($1, '61244C4', 10, $2, 'L-9', '2027-01-31')`,
  [doc.pedido, anden],
)
check(despues?.includes('ya está cerrado'), 'cerrada el acta, no se le agrega nada mas')

const dosVeces = await falla(`select cerrar_ingreso_sin_aviso($1)`, [doc.pedido])
check(dosVeces?.includes('ya está cerrado'), 'ni se cierra dos veces')

const yaNo = await db.query(`select pedido from ingreso_abierto where pedido = $1`, [doc.pedido])
check(yaNo.rows.length === 0, 'y sale de la lista de abiertos')

// ---------------------------------------------------------------------------------------
// El pallet mixto (0067)
// ---------------------------------------------------------------------------------------
// Un mixto se descubre en el anden, y se desarma ahi mismo: del almacen solo salen pallets
// completos de un producto. Cada producto sale como su propio pallet, colgando de la etiqueta
// que de verdad venia en el camion.

const mix = await one(`select * from abrir_ingreso_sin_aviso('Planta Choloma', 'Vino mixto')`)
const mixto = (productos, pallet = null) =>
  db.query(`select * from recibir_mixto($1, $2::jsonb, $3, $4)`, [
    mix.pedido,
    JSON.stringify(productos),
    anden,
    pallet,
  ])

const uno = await falla(`select * from recibir_mixto($1, $2::jsonb, $3, null)`, [
  mix.pedido,
  JSON.stringify([{ codigo: '61244C4', cases: 10, expiry: '2027-01-31' }]),
  anden,
])
check(uno?.includes('al menos dos productos'), 'un pallet de un solo producto se recibe normal')

const repetido = await falla(`select * from recibir_mixto($1, $2::jsonb, $3, null)`, [
  mix.pedido,
  JSON.stringify([
    { codigo: '61244C4', cases: 10, lot: 'L-1', expiry: '2027-01-31' },
    { codigo: '61244C4', cases: 5, lot: 'L-1', expiry: '2027-01-31' },
  ]),
  anden,
])
check(repetido?.includes('ya está en el pallet'), 'el mismo producto y lote no se apunta dos veces')

const sinVence = await falla(`select * from recibir_mixto($1, $2::jsonb, $3, null)`, [
  mix.pedido,
  JSON.stringify([
    { codigo: '61244C4', cases: 10, expiry: '2027-01-31' },
    { codigo: '61244P4', cases: 5 },
  ]),
  anden,
])
check(sinVence?.includes('FEFO'), 'y a cada producto del mixto se le pide su vencimiento')

const sinCuantas = await falla(`select * from recibir_mixto($1, $2::jsonb, $3, null)`, [
  mix.pedido,
  JSON.stringify([
    { codigo: '61244C4', cases: 10, expiry: '2027-01-31' },
    { codigo: '61244P4', cases: 0, expiry: '2027-01-31' },
  ]),
  anden,
])
check(sinCuantas?.includes('cuántas cajas'), 'ni se recibe sin decir cuantas cajas trae cada uno')

const desarmado = (
  await mixto(
    [
      { codigo: '61244C4', cases: 20, lot: 'L-A', expiry: '2027-03-31' },
      { codigo: '61244P4', cases: 12, expiry: '2027-04-30' },
    ],
    'PAL-MIX-001',
  )
).rows

check(desarmado.length === 2, 'el mixto se desarma en un pallet por producto')
check(
  desarmado.every((p) => p.madre === 'PAL-MIX-001'),
  'y los dos cuelgan de la etiqueta que traia el camion',
)
check(
  desarmado.every((p) => p.lpn_code.startsWith('WMS-')),
  'cada pieza lleva matricula propia, que es la que hay que imprimir y pegar',
)

const madre = await one(`select id, source from lpn where code = 'PAL-MIX-001'`)
const saldoMadre = await one(
  `select count(*)::int as n from stock where lpn_id = $1`,
  [madre.id],
)
check(saldoMadre.n === 0, 'la madre no lleva saldo: el producto cuelga de las hijas')
check(madre.source === 'NEST', 'y la madre sigue siendo la etiqueta de planta')

const hijas = await db.query(
  `select l.code, l.parent_id, l.source, s.qty_base, p.sku
   from lpn l join stock s on s.lpn_id = l.id join product p on p.id = s.product_id
   where l.parent_id = $1 order by p.sku`,
  [madre.id],
)
check(hijas.rows.length === 2, 'las dos hijas quedan colgadas de la madre')
check(
  hijas.rows.every((h) => h.source === 'PROVISIONAL'),
  'y marcadas como provisionales, porque la matricula la invento el WMS',
)
check(
  Number(hijas.rows[0].qty_base) === 480 && Number(hijas.rows[1].qty_base) === 288,
  'con el saldo de cada producto en unidades: 20 y 12 cajas de 24',
)

const tareasMixto = await db.query(
  `select count(*)::int as n from task where type = 'PUTAWAY' and lpn_id in (
     select id from lpn where parent_id = $1)`,
  [madre.id],
)
check(tareasMixto.rows[0].n === 2, 'y cada pieza deja su tarea de guardado, por separado')

const actaMixto = await one(
  `select count(*)::int as n from inbound_pallet where doc_id = $1`,
  [mix.id],
)
check(actaMixto.n === 2, 'el acta del ingreso cuenta las piezas, no la madre')

// Escanear la etiqueta de la madre no encuentra saldo, porque ya no lo tiene. Lo que sí
// contesta es qué venía en ese pallet y dónde quedó cada cosa.
const porMadre = await db.query(`select * from hermanas_del_pallet('PAL-MIX-001')`)
check(porMadre.rows.length === 2, 'la etiqueta de la madre dice que venia en ese pallet')
check(
  porMadre.rows.every((h) => h.posicion !== null),
  'y donde quedo cada cosa',
)

const porHija = await db.query(`select * from hermanas_del_pallet($1)`, [hijas.rows[0].code])
check(porHija.rows.length === 2, 'y desde una pieza se ve con que vino')

const normal = await db.query(`select * from hermanas_del_pallet('PAL-NEST-001')`)
check(normal.rows.length === 0, 'un pallet de un solo producto no arrastra hermanas')

const madreRepetida = await falla(
  `select * from recibir_mixto($1, $2::jsonb, $3, 'PAL-MIX-001')`,
  [
    mix.pedido,
    JSON.stringify([
      { codigo: '61244C4', cases: 1, expiry: '2027-03-31' },
      { codigo: '61244P4', cases: 1, expiry: '2027-04-30' },
    ]),
    anden,
  ],
)
check(madreRepetida?.includes('ya está en el sistema'), 'la etiqueta de la madre no entra dos veces')

const sinEtiquetaMixto = (
  await mixto([
    { codigo: '61244C4', cases: 3, expiry: '2027-05-31' },
    { codigo: '61244P4', cases: 4, expiry: '2027-06-30' },
  ])
).rows
check(
  sinEtiquetaMixto[0].madre.startsWith('WMS-'),
  'un mixto sin etiqueta tambien se recibe: el WMS le pone madre propia',
)
const madrePropia = await one(`select source from lpn where code = $1`, [
  sinEtiquetaMixto[0].madre,
])
check(madrePropia.source === 'PROVISIONAL', 'y esa madre queda marcada como provisional')
