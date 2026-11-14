// Llena la bodega de datos sinteticos para poder probar los procesos completos.
//   node scripts/datos-sinteticos.mjs            crea
//   node scripts/datos-sinteticos.mjs --limpiar  deja la bodega vacia otra vez
//
// Por que hace falta: la bodega esta vacia, y sin existencia no se puede probar ni el surtido,
// ni el reabastecimiento, ni los conteos, ni el despacho. Los ingresos NO se inventan: ya hay
// 366 documentos reales cargados desde el archivo de SAP con sus 10,395 pallets, y esos se
// prueban tal cual.
//
// Todo lo que crea lleva marca para poder borrarlo: el lote empieza con `SINT-`, la matricula
// con `SINT-`, y los pedidos con `SINT-TAB`. El libro mayor no se borra —es inmutable a
// proposito—, asi que `--limpiar` deja la existencia en cero con ajustes, no borrando filas.
import { loadEnv } from './lib/env.mjs'

const env = loadEnv(['SUPABASE_PROJECT_REF', 'SUPABASE_ACCESS_TOKEN'])

const PRODUCTOS = 140
const POSICIONES_PICKING = 260
const POSICIONES_ALMACEN = 900
const PEDIDOS = 25
const TANDA = 300

async function sql(query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    },
  )
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 700)}`)
  return text ? JSON.parse(text) : []
}

const uno = async (query) => (await sql(query))[0]

/** Los productos que se usan, siempre los mismos: el maestro no cambia entre corridas. */
const ELEGIDOS = `
  elegidos as (
    select p.id as product_id, pl.id as case_id, pl.qty_base_units as por_caja,
           coalesce(pc.cases_per_pallet, 60) as cxp,
           row_number() over (order by p.sku) as n
    from product p
    join packaging_level pl on pl.product_id = p.id and pl.code = 'CASE'
    left join pallet_config pc on pc.product_id = p.id
    where pl.qty_base_units > 0
    order by p.sku
    limit ${PRODUCTOS}
  )`

/**
 * Las posiciones de un area, en orden de recorrido y en tandas.
 *
 * Van en tandas porque `post_movement` serializa la cadena de hash con un lock: mil pallets en
 * una sola sentencia se pasan del tiempo que aguanta la API de gestion.
 */
const posiciones = (area, desde, cuantas) => `
  pos as (
    select id, code, n from (
      select l.id, l.code, row_number() over (order by l.code) as n
      from location l
      where (area_de(l.id)).code = '${area}'
        and l.retired_at is null and l.status = 'available'
    ) t where n > ${desde} and n <= ${desde + cuantas}
  )`

/** Una tanda de pallets: uno por posicion, cada uno con su matricula, lote y vencimiento. */
async function llenar(area, desde, cuantas, lleno) {
  const query = `
    with ${ELEGIDOS}, ${posiciones(area, desde, cuantas)},
    par as (
      select pos.id as loc, pos.n,
             e.product_id, e.case_id, e.por_caja, e.cxp,
             'SINT-' || upper(left('${area}', 1)) || lpad(pos.n::text, 5, '0') as pallet,
             'SINT-' || chr(65 + (pos.n % 8)::integer) as lote,
             case when pos.n % 60 = 0 then current_date - ((pos.n % 20) + 1)::integer
                  else current_date + (((pos.n * 17) % 280) + 5)::integer end as vence,
             ${lleno ? 'e.cxp' : '((pos.n * 7) % 34 + 4)'} as cajas,
             ${lleno ? '0' : '((pos.n * 5) % e.por_caja::integer)'} as sueltas
      from pos
      join elegidos e on e.n = ((pos.n - 1) % ${PRODUCTOS}) + 1
    ),
    nuevos as (
      -- Las matriculas de una corrida anterior siguen ahi: el libro mayor las referencia y no
      -- se dejan borrar. Se reusan.
      insert into lpn (code, source, level)
      select pallet, 'INTERNO', 'PALLET' from par
      on conflict (code) do update set source = excluded.source
      returning id, code
    )
    select count(*)::int as pallets, sum(par.cajas * par.por_caja + par.sueltas)::int as unidades
    from par
    join nuevos on nuevos.code = par.pallet
    cross join lateral (
      select post_movement(
        'RECEIPT'::movement_type, par.product_id, par.cajas * par.por_caja + par.sueltas,
        null, par.loc, nuevos.id, par.lote, par.vence, 'CARGA_INICIAL',
        'Datos sintéticos', par.case_id
      )
    ) m`
  return uno(query)
}

async function crear() {
  const yaHay = await uno(`select count(*)::int as n from stock where lot like 'SINT-%'`)
  if (yaHay.n > 0) {
    console.log(`Ya hay ${yaHay.n} filas de existencia sintética. Corre con --limpiar primero.`)
    return
  }

  console.log('Picking: pallets abiertos, con cajas y unidades sueltas')
  for (let i = 0; i < POSICIONES_PICKING; i += TANDA) {
    const n = Math.min(TANDA, POSICIONES_PICKING - i)
    const r = await llenar('PICKING', i, n, false)
    console.log(`  ${r.pallets} pallets, ${r.unidades.toLocaleString('es-HN')} unidades`)
  }

  console.log('Almacén: pallets completos')
  for (let i = 0; i < POSICIONES_ALMACEN; i += TANDA) {
    const n = Math.min(TANDA, POSICIONES_ALMACEN - i)
    const r = await llenar('ALMACEN', i, n, true)
    console.log(`  ${r.pallets} pallets, ${r.unidades.toLocaleString('es-HN')} unidades`)
  }

  console.log('Pedidos de despacho, sin liberar')
  const ped = await uno(`
    with docs as (
      insert into sales_order (code, customer, transporte, dock_door_id, status)
      select 'SINT-TAB' || lpad(g::text, 3, '0'),
             'Cliente sintético ' || g,
             'SINT-TAB' || lpad(g::text, 3, '0'),
             -- Sólo andenes de despacho. Repartirlos entre los primeros catorce por orden de
             -- código los ponía a todos en recepción.
             (select dock_door_id from anden_de_carga
               order by anden offset (g % (select count(*) from anden_de_carga)) limit 1),
             -- Sin nota: ship_note es la razon por la que un camion salio corto, y la
             -- precision de los despachos la mira. Un pedido de prueba no trae razon.
             'DRAFT'
      from generate_series(1, ${PEDIDOS}) g
      returning id, code
    ),
    numerados as (select id, row_number() over (order by code) as g from docs),
    prods as (
      select s.product_id, pl.id as case_id, pl.qty_base_units as por_caja,
             row_number() over (order by s.product_id) as n
      from stock s
      join packaging_level pl on pl.product_id = s.product_id and pl.code = 'CASE'
      where s.qty_base > 0 and s.lot like 'SINT-%'
      group by s.product_id, pl.id, pl.qty_base_units
    ),
    lineas as (
      insert into order_line (order_id, line_no, product_id, packaging_level_id, qty_base)
      select nu.id, ln::smallint, pr.product_id, pr.case_id,
             ((nu.g * 7 + ln * 13) % 38 + 3) * pr.por_caja
      from numerados nu
      cross join lateral generate_series(1, 1 + ((nu.g * 3) % 5)::integer) ln
      join prods pr
        on pr.n = ((nu.g * 5 + ln * 11) % (select count(*)::integer from prods)) + 1
      returning order_id
    )
    select (select count(*)::int from docs) as pedidos,
           (select count(*)::int from lineas) as lineas`)
  console.log(`  ${ped.pedidos} pedidos con ${ped.lineas} líneas`)

  await resumen()
}

async function limpiar() {
  console.log('Soltando lo apartado y las tareas')
  // Soltar lo apartado sin devolverlo a `qty_allocated` dejaria la existencia reservada para
  // siempre contra una tarea que ya no existe.
  await sql(`
    with sueltas as (
      delete from allocation a
      using stock s
      where s.id = a.stock_id and s.lot like 'SINT-%'
      returning a.stock_id, a.qty_base
    ),
    suma as (select stock_id, sum(qty_base) as q from sueltas group by stock_id)
    update stock s set qty_allocated = greatest(0, s.qty_allocated - suma.q)
    from suma where s.id = suma.stock_id`)

  // Solo las tareas sinteticas: las de los ingresos reales no se tocan.
  await sql(`
    update task t set status = 'CANCELLED', completed_at = now(),
                      closed_reason = 'Datos sintéticos borrados'
    where t.status not in ('DONE', 'CANCELLED')
      and (
        t.lot like 'SINT-%'
        or exists (select 1 from lpn l where l.id = t.lpn_id and l.code like 'SINT-%')
      )`)
  await sql(`delete from order_line l using sales_order o
             where o.id = l.order_id and o.code like 'SINT-%'`)
  await sql(`delete from sales_order where code like 'SINT-%'`)

  console.log('Dejando la existencia sintética en cero')
  let vueltas = 0
  for (;;) {
    const r = await uno(`
      with sobra as (
        select s.id, s.product_id, s.location_id, s.lpn_id, s.lot, s.expiry_date, s.qty_base
        from stock s where s.lot like 'SINT-%' and s.qty_base > 0
        limit ${TANDA}
      )
      select count(*)::int as n
      from sobra
      cross join lateral (
        select post_movement(
          'ADJUST'::movement_type, sobra.product_id, sobra.qty_base, sobra.location_id, null,
          sobra.lpn_id, sobra.lot, sobra.expiry_date, 'CARGA_INICIAL',
          'Borrado de los datos sintéticos'
        )
      ) m`)
    if (r.n === 0) break
    console.log(`  ${r.n} posiciones vaciadas`)
    if (++vueltas > 50) throw new Error('Demasiadas vueltas vaciando')
  }

  await sql(`delete from stock where lot like 'SINT-%' and qty_base = 0`)
  // Las matriculas se quedan: el libro mayor las referencia y es inmutable a proposito. Lo
  // que se borra es lo que las hace estorbar, que es la existencia.
  const quedan = await uno(`select count(*)::int as n from lpn where code like 'SINT-%'`)
  console.log(`  ${quedan.n} matrículas sintéticas quedan en el libro mayor, sin existencia`)
  await resumen()
}

async function resumen() {
  const r = await uno(`
    select (select count(*)::int from stock where qty_base > 0) as posiciones_con_producto,
           (select count(distinct product_id)::int from stock where qty_base > 0) as productos,
           (select count(*)::int from sales_order) as pedidos,
           (select count(*)::int from task where status not in ('DONE','CANCELLED')) as tareas`)
  console.log(
    `\nAhora: ${r.posiciones_con_producto} posiciones con producto, ${r.productos} productos, ` +
      `${r.pedidos} pedidos, ${r.tareas} tareas abiertas`,
  )
}

if (process.argv.includes('--limpiar')) await limpiar()
else await crear()
