import { bootDb, check } from './lib/boot-db.mjs'

/**
 * La ventana de la descarga.
 *
 * Nadie baja de SAP siempre lo mismo: el ZRDT y los cuatro ZRDN se bajan cada dia, a veces con
 * el mes entero y a veces con los ultimos dos dias, y a veces el documento todavia no esta
 * completo. El WMS tiene que dar lo mismo en los tres casos.
 *
 * Lo que aqui se fija: que un documento que no viene en la ventana no se toque, que el resumen
 * de un pedido sea siempre el de **todos** sus pallets y no el de los que traia el archivo de
 * hoy, y que a un pedido que entro por el ZMB51 no se le borren las lineas porque llego un ZRDN
 * suyo con el material fuera del maestro.
 */

const db = await bootDb()
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const todas = async (sql, params) => (await db.query(sql, params)).rows

await one(
  `insert into product (sku, name, base_uom, base_code, variant)
   values ('61244.4', 'Galleta 24s', 'ST', '61244', '.4')`,
)
const { id: producto } = await one(`select id from product where sku = '61244.4'`)
await one(`insert into packaging_level (product_id, code, qty_base_units) values ($1, 'CASE', 24)`, [
  producto,
])

// --- el ingreso: la Fecha del ZRDN es del pallet, no del pedido ---------------------------

const pallet = (pedido, codigo, fecha, cajas) => ({
  pedido,
  pallet: codigo,
  material: '61244.4',
  cajas,
  lote: 'LOTDS44',
  vencimiento: '2027-05-01',
  planta: 'SN',
  fecha,
  entrega: '700157382',
  salida: '4946925469',
  mix: '2610319772',
  centro: '1003',
  a_ciegas: false,
})

const ingresar = async (filas) =>
  (await one(`select cargar_ingresos($1::jsonb) as r`, [JSON.stringify(filas)])).r

const resumenDe = async (pedido) =>
  Number(
    (
      await one(
        `select coalesce(sum(l.qty_cases), 0) as c from inbound_line l
         join inbound_doc d on d.id = l.doc_id where d.pedido = $1`,
        [pedido],
      )
    ).c,
  )

const palletsDe = async (pedido) =>
  (
    await todas(
      `select ip.pallet_code from inbound_pallet ip
       join inbound_doc d on d.id = ip.doc_id where d.pedido = $1 order by ip.pallet_code`,
      [pedido],
    )
  )
    .map((r) => r.pallet_code)
    .join(' ')

// El archivo del mes: dos pallets del mismo pedido, uno del día 2 y otro del 3.
await ingresar([pallet('A', 'P1', '2026-11-02', 30), pallet('A', 'P2', '2026-11-03', 40)])
check((await resumenDe('A')) === 70, 'con el mes entero el pedido suma sus 70 cajas')

// Al día siguiente se bajan sólo los últimos dos días: el pallet del 2 ya no viene en el
// archivo. Es el caso real: 18 de los 183 pedidos del ZRDN de Snacks tienen pallets de dos días.
await ingresar([pallet('A', 'P2', '2026-11-03', 40), pallet('A', 'P3', '2026-11-04', 50)])
check((await palletsDe('A')) === 'P1 P2 P3', 'la ventana corta no borra el pallet que no trae')
check(
  (await resumenDe('A')) === 120,
  'y el resumen son los tres pallets, no sólo los que venían en el archivo',
)

// Y volver a subir el mes entero no cambia nada.
await ingresar([
  pallet('A', 'P1', '2026-11-02', 30),
  pallet('A', 'P2', '2026-11-03', 40),
  pallet('A', 'P3', '2026-11-04', 50),
])
check((await resumenDe('A')) === 120, 'subir el mes entero después deja lo mismo')

// Un pedido que no viene en la ventana de hoy no se toca.
await ingresar([pallet('B', 'Q1', '2026-11-10', 12)])
await ingresar([pallet('A', 'P4', '2026-11-11', 8)])
check((await resumenDe('B')) === 12, 'el pedido que no viene en el archivo se queda como estaba')
check((await resumenDe('A')) === 128, 'y el que sí viene suma el pallet nuevo')

// --- el complemento llega mientras se descarga ---------------------------------------------

await db.query(`update inbound_doc set status = 'RECEIVING' where pedido = 'A'`)
await ingresar([pallet('A', 'P5', '2026-11-12', 6)])
check(
  (await resumenDe('A')) === 134,
  'el complemento entra aunque el camión se esté descargando: esos pallets hay que bajarlos',
)
check(
  (await one(`select status from inbound_doc where pedido = 'A'`)).status === 'RECEIVING',
  'y el archivo no le devuelve el estado hacia atrás',
)

// Lo ya recibido es historia: el archivo no la corrige.
await db.query(
  `update inbound_pallet set received_at = now()
   where pallet_code = 'P1' and doc_id = (select id from inbound_doc where pedido = 'A')`,
)
await ingresar([pallet('A', 'P1', '2026-11-02', 999)])
check(
  (await resumenDe('A')) === 134,
  'y un pallet ya recibido no cambia de cantidad porque el archivo venga con otra',
)

// --- el pedido del ZMB51, que tiene líneas y no tiene pallets --------------------------------

await one(
  `select cargar_salidas($1::jsonb) as r`,
  [
    JSON.stringify([
      {
        pedido: 'C',
        documento: '4947219291',
        material: '61244.4',
        cantidad: 55,
        centro: '3001',
        centro_receptor: '1003',
        clase: '641',
        fecha: '2026-11-09',
      },
    ]),
  ],
)
check((await resumenDe('C')) === 55, 'el pedido del ZMB51 entra con su línea y sin pallets')

// Llega un ZRDN suyo, pero con un material que no está en el maestro y que el archivo tampoco
// nombra: esa fila sí se cae, y no hay pallets que guardar. Las líneas que ya tenía no se
// pueden borrar, que son lo único que hay.
const sinMaestro = { ...pallet('C', 'R1', '2026-11-09', 20), material: '99999.9' }
const r = await ingresar([sinMaestro])
check(r.sin_producto === 1, 'el material fuera del maestro se cuenta y se dice')

// Y el que trae nombre entra solo: un camión no se queda fuera porque el maestro no tenga el
// material. Lo que no se inventa es el código de barras, ni la estiba, ni la clase.
const r2 = await ingresar([
  {
    ...pallet('D', 'S1', '2026-11-12', 20),
    material: '71001.6',
    nombre: 'Jabon Azul 6s',
  },
])
check(r2.creados === 1, 'el material que trae nombre se da de alta solo')
check(r2.sin_producto === 0, 'y entonces no se cae ninguna fila')

const nuevo = await one(
  `select p.name, p.external_source, p.contamination_class,
          (select pl.qty_base_units from packaging_level pl
            where pl.product_id = p.id and pl.code = 'CASE') as por_caja
     from product p where p.sku = '71001.6'`,
)
check(nuevo.name === 'Jabon Azul 6s', 'con el nombre que traia el archivo')
check(Number(nuevo.por_caja) === 6, 'y el corrugado que dice el nombre: seis unidades')
check(nuevo.contamination_class === null, 'sin clase: eso lo dice quien lo recibe')
check(nuevo.external_source !== null, 'y marcado para que Datos Maestros lo complete')
check((await resumenDe('D')) === 20, 'el pallet entra con su linea')

// Subir otra vez el mismo archivo no lo da de alta dos veces.
const r3 = await ingresar([
  {
    ...pallet('D', 'S1', '2026-11-12', 20),
    material: '71001.6',
    nombre: 'Jabon Azul 6s',
  },
])
check(r3.creados === 0, 'y la segunda vez ya no se da de alta nada')
check(
  (await resumenDe('C')) === 55,
  'y la línea que traía del ZMB51 sigue ahí: no se borra lo único que hay',
)

// --- el despacho: las fechas del ZRDT son del transporte, no de la línea ---------------------

const linea = (transporte, posicion, cantidad) => ({
  transporte,
  entrega: '700157391',
  posicion,
  material: '61244.4',
  cantidad,
  um: 'CA',
  cliente: 'Pulpería del Centro',
})
const despachar = async (filas) =>
  (await one(`select cargar_despachos($1::jsonb) as r`, [JSON.stringify(filas)])).r
const cajasDe = async (code) =>
  Number(
    (
      await one(
        `select coalesce(sum(l.qty_base), 0) as c from order_line l
         join sales_order o on o.id = l.order_id where o.code = $1`,
        [code],
      )
    ).c,
  )

await despachar([linea('T1', 10, 5), linea('T2', 10, 3)])
check((await cajasDe('T1')) === 120 && (await cajasDe('T2')) === 72, 'los dos camiones entran')

// La ventana de dos días trae T2 con su complemento y no trae T1.
await despachar([linea('T2', 10, 3), linea('T2', 20, 4)])
check((await cajasDe('T1')) === 120, 'el camión que no viene en la ventana se queda como estaba')
check((await cajasDe('T2')) === 168, 'y el que viene queda con su complemento entero')
