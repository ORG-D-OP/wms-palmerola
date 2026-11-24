// Convierte la foto de existencia de SAP en existencia del WMS, con posicion, lote y
// vencimiento.
//   node scripts/existencia-de-sap.mjs            siembra
//   node scripts/existencia-de-sap.mjs --limpiar  deja la bodega vacia otra vez
//
// Por que hace falta: `sap_stock` es un retrato con fecha de lo que SAP dice que hay, por
// centro, almacen y material. No dice **en que posicion** esta cada pallet, ni trae lote ni
// vencimiento, asi que de ahi no sale un inventario ubicado. Esto lo construye.
//
// Las tres cosas que decide, y por que:
//
// 1. **No cabe.** Palmerola (almacenes 0006, 0010, 0020 y 00ZC) pide mas de seis mil pallets
//    y la bodega tiene 5,605 posiciones, de las que el almacen aporta 1,594 carriles y un
//    carril no aguanta dos productos a la vez. Asi que **manda el pronostico**: primero todos
//    los productos cogen su posicion de picking —ahi no hay regla de carril—, y despues el
//    grueso se reparte por almacen en orden de pallets pronosticados, hasta que se acaban los
//    carriles. Lo que no cupo se reporta, no se inventa sitio.
//
// 2. **El apilado lo pone la base.** Hay productos que van de a dos y de a tres en una
//    posicion de piso; eso vive en `pallet_config.max_stack` y lo resuelve
//    `pallets_que_caben`, que es la misma funcion que usa la colocacion de verdad. Aqui no se
//    duplica esa cuenta.
//
// 3. **Los lotes son inventados, y se nota.** La foto no los trae. Cada producto sale con dos:
//    el de picking vence antes que el del almacen, que es la situacion real y le da al FEFO
//    dos fechas que comparar. Todos empiezan con `SAP14-`, para poder borrarlos.
import { loadEnv } from './lib/env.mjs'

const env = loadEnv(['SUPABASE_PROJECT_REF', 'SUPABASE_ACCESS_TOKEN'])

/** Los almacenes de Palmerola. Los demas del centro 1003 son de otras bodegas. */
const ALMACENES = ["'0006'", "'0010'", "'0020'", "'00ZC'"].join(', ')
/** Cuantos pallets por vuelta. `post_movement` serializa la cadena de hash con un lock. */
const TANDA = 250
/** Si el maestro no dice la vida util, medio ano. */
const VIDA_POR_DEFECTO = 180
/**
 * Que parte de los carriles de almacen se deja libre, por grupo.
 *
 * Sin esto la siembra llena la bodega hasta el ultimo carril y el primer camion que llega no
 * tiene donde descargar: medido el 24/11/2026, cero carriles de alimento libres. Una bodega
 * de verdad no opera al cien por ciento. Este margen es lo que deja la siembra para que el
 * ingreso tenga a donde ir.
 */
const MARGEN = 0.1

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
const miles = (n) => Number(n ?? 0).toLocaleString('es-HN')

/**
 * El plan: una fila por pallet, en el orden en que se va a colocar.
 *
 * `fase` 1 es el pallet de picking —uno por producto, el que vence antes— y `fase` 2 es el
 * grueso. Dentro de cada fase manda el pronostico. Se guarda en una tabla porque la colocacion
 * va por tandas y cada tanda tiene que saber que queda pendiente.
 */
async function planificar() {
  await sql('drop table if exists siembra_sap')
  const r = await uno(`
    create table siembra_sap as
    with foto as (
      select s.product_id, sum(s.free_base) as base
      from sap_stock s
      where s.almacen in (${ALMACENES})
        and s.product_id is not null
        and s.taken_on = (select max(taken_on) from sap_stock)
      group by s.product_id
      having sum(s.free_base) > 0
    ),
    demanda as (
      select sku, sum(pallets) as pallets
      from product_forecast group by sku
    ),
    datos as (
      select f.product_id, p.sku,
             pl.id as case_id, pl.qty_base_units as por_caja,
             coalesce(pc.cases_per_pallet, 60) as cxp,
             coalesce(p.shelf_life_days, ${VIDA_POR_DEFECTO}) as vida,
             clase_abc(p.id) as clase,
             case when pc.allows_stacking then coalesce(pc.max_stack, 1) else 1 end as apilado,
             f.base,
             row_number() over (
               order by coalesce(d.pallets, 0) desc, p.sku
             ) as rango
      from foto f
      join product p on p.id = f.product_id
      join packaging_level pl on pl.product_id = p.id and pl.code = 'CASE'
      left join pallet_config pc on pc.product_id = p.id and pc.is_default
      left join demanda d on d.sku = p.sku
      where pl.qty_base_units > 0
    ),
    -- Cuantos pallets completos salen y que sobra. La sobra va al pallet de picking, que es
    -- donde viven las cajas partidas y las unidades sueltas.
    partido as (
      select *,
             floor(base / (por_caja * cxp))::int as enteros,
             base - floor(base / (por_caja * cxp)) * por_caja * cxp as resto
      from datos
    ),
    picking as (
      select product_id, sku, case_id, por_caja, rango, clase, apilado, 1 as fase, 0 as i,
             -- Cuando la cantidad da pallets justos, el de picking sale de ellos: contarlo
             -- aparte sembraba un pallet de mas.
             case when resto > 0 then resto else por_caja * cxp end as base_pallet,
             -- El de picking vence antes: es el que se surte y el que el FEFO tiene que sacar
             -- primero. Un 15% de la vida util, desplazado por producto para que no venzan
             -- todos el mismo dia. El desplazamiento es proporcional a la vida: fijo, en un
             -- producto de quince dias se comia la diferencia y el FEFO nacia invertido.
             (current_date + ((vida * 15 / 100) + (rango % greatest(vida / 10, 2)))::int)
               as vence,
             'SAP14-A' as sufijo
      from partido
    ),
    almacen as (
      select p.product_id, p.sku, p.case_id, p.por_caja, p.rango, p.clase, p.apilado,
             2 as fase, g as i,
             p.por_caja * p.cxp as base_pallet,
             -- El del almacen, siempre despues del de picking: se parte de la misma cuenta
             -- y se le suma, en vez de desplazar los dos por su lado.
             (current_date + ((p.vida * 15 / 100) + (p.rango % greatest(p.vida / 10, 2))
               + greatest(p.vida * 30 / 100, 7))::int) as vence,
             'SAP14-B' as sufijo
      from partido p
      cross join lateral generate_series(1, p.enteros - case when p.resto > 0 then 0 else 1 end) g
      where p.enteros - case when p.resto > 0 then 0 else 1 end > 0
    ),
    todo as (select * from picking union all select * from almacen)
    select
      row_number() over (order by fase, rango, i) as n,
      product_id, sku, case_id, fase, rango, clase, apilado,
      base_pallet::numeric as base_pallet,
      vence,
      sufijo || '-' || lpad(rango::text, 3, '0') as lote,
      'SAP14-' || lpad(row_number() over (order by fase, rango, i)::text, 6, '0') as matricula,
      null::uuid as location_id,
      'pendiente'::text as estado
    from todo;

    create index on siembra_sap (estado, n);

    select count(*)::int as pallets,
           count(distinct product_id)::int as productos,
           sum(base_pallet)::numeric as unidades
    from siembra_sap`)
  return r
}

/**
 * Decide la posicion de cada pallet, aqui y no en la base.
 *
 * La funcion de la operacion, `suggest_putaway_location`, tarda unos 200 ms por llamada y
 * aqui hay seis mil pallets: veinte minutos de ida y vuelta. Asi que se bajan el catalogo de
 * posiciones y el plan una sola vez y el reparto se hace en memoria, con **las mismas
 * reglas**: una posicion de picking libre por producto, el carril de almacen no mezcla dos
 * productos —y el carril del rack es la pareja frente/fondo de una bahia a un nivel, la
 * columna `location.carril`—, el rack aguanta un pallet por posicion y el piso tantos como
 * diga el apilado del producto, y el orden de recorrido se invierte para los productos de
 * clase C, que van a lo ultimo.
 */
async function repartir() {
  const plan = await sql(`
    select n, product_id, sku, case_id, fase, rango, clase, apilado,
           base_pallet, vence, lote, matricula
    from siembra_sap order by n`)

  const posiciones = await sql(`
    select l.id, l.code, l.kind, l.carril, coalesce(l.level, 0) as level,
           l.pick_sequence, l.max_pallets_stacked, l.grupo, a.code as area
    from location l
    join location_usage u on u.code = l.usage_code
    join location_area lar on lar.location_id = l.id and lar.valid_to is null
    join area a on a.id = lar.area_id
    join area_type tp on tp.code = a.type_code
    where l.retired_at is null and l.status = 'available'
      and l.reserved_by_task_id is null
      and u.holds_product and a.is_active and not tp.is_virtual
      and a.code in ('PICKING', 'ALMACEN')
      and not exists (select 1 from stock s where s.location_id = l.id and s.qty_base > 0)`)

  // El orden de recorrido, que es el que usa la colocacion de verdad: nivel bajo primero y
  // despues la secuencia de picking, al reves para los C.
  const ordenar = (lista, clase) =>
    [...lista].sort(
      (a, b) =>
        a.level - b.level ||
        (a.pick_sequence ?? Infinity) * (clase === 'C' ? -1 : 1) -
          (b.pick_sequence ?? Infinity) * (clase === 'C' ? -1 : 1) ||
        a.code.localeCompare(b.code),
    )

  // Lo que no es alimento tiene su sitio y nada mas entra ahi (migracion 0096).
  const noAlimento = new Set(
    (
      await sql(`
        select id from product
        where contamination_class in ('QUIMICO', 'NO_ALIMENTO', 'AROMATICO')`)
    ).map((p) => p.id),
  )
  const grupoDe = (p) => (noAlimento.has(p.product_id) ? 'NO_ALIMENTO' : 'ALIMENTO')
  const cabe = (l, pallet) => l.grupo === grupoDe(pallet)

  const picking = posiciones.filter((l) => l.area === 'PICKING')
  const carriles = new Map()
  for (const l of posiciones.filter((p) => p.area === 'ALMACEN')) {
    const ya = carriles.get(l.carril)
    if (ya) ya.push(l)
    else carriles.set(l.carril, [l])
  }

  const pickingLibre = new Set(picking.map((l) => l.id))
  const carrilLibre = new Set(carriles.keys())

  // El margen de operacion, contado por grupo: el alimento y el no alimento no se prestan
  // sitio, asi que un margen global dejaria libres los ochenta carriles del no alimento y
  // cero de alimento, que es justo el caso que hay que evitar.
  const grupoDelCarril = (id) => carriles.get(id)[0].grupo ?? 'ALIMENTO'
  const libresPorGrupo = new Map()
  for (const id of carrilLibre) {
    const g = grupoDelCarril(id)
    libresPorGrupo.set(g, (libresPorGrupo.get(g) ?? 0) + 1)
  }
  const reserva = new Map(
    [...libresPorGrupo].map(([g, n]) => [g, Math.round(n * MARGEN)]),
  )
  const quedaMargen = (g) => (libresPorGrupo.get(g) ?? 0) > (reserva.get(g) ?? 0)
  const tomarCarril = (id) => {
    carrilLibre.delete(id)
    const g = grupoDelCarril(id)
    libresPorGrupo.set(g, (libresPorGrupo.get(g) ?? 0) - 1)
  }
  /** Cuantos pallets quedan en cada posicion ya empezada. */
  const hueco = new Map()
  /** Los carriles que ya cogio cada producto: un carril no mezcla dos productos. */
  const mios = new Map()
  /** El lote y el vencimiento de la cara de picking que manda en cada carril de rack. */
  const cara = new Map()

  const cabida = (l, apilado) =>
    l.kind === 'floor_stack' ? Math.min(apilado, l.max_pallets_stacked ?? 10) : 1

  const puestos = []
  const sinSitio = []

  for (const pallet of plan) {
    let destino = null

    if (pallet.fase === 1) {
      // Una cara de rack sirve si el fondo de su bahia sigue libre o ya es de este producto:
      // el fondo es la reserva de la cara y no puede tener otro dueno (migracion 0095).
      const sirve = (l) =>
        pickingLibre.has(l.id) &&
        cabe(l, pallet) &&
        (!carriles.has(l.carril) ||
          carrilLibre.has(l.carril) ||
          (mios.get(pallet.product_id) ?? []).includes(l.carril))
      const libre = ordenar(picking.filter(sirve), pallet.clase)[0]
      if (libre) {
        pickingLibre.delete(libre.id)
        destino = libre
        // En rack la cara es el frente de la bahia y el fondo es su reserva (migracion 0095):
        // el carril queda a nombre del producto y nadie mas puede entrar ahi. En piso la cara
        // no arrastra nada, porque su carril entero es de picking.
        if (carriles.has(libre.carril)) {
          tomarCarril(libre.carril)
          mios.set(pallet.product_id, [...(mios.get(pallet.product_id) ?? []), libre.carril])
          cara.set(libre.carril, { lote: pallet.lote, vence: pallet.vence })
        }
      }
    }

    if (!destino) {
      const apilado = Number(pallet.apilado) || 1
      const suyos = mios.get(pallet.product_id) ?? []

      // Primero los carriles que este producto ya tiene abiertos, que es lo que hace la
      // funcion de la operacion al preferir una posicion que ya lleva lo mismo.
      for (const lane of suyos) {
        destino = ordenar(carriles.get(lane) ?? [], pallet.clase).find(
          (l) => (hueco.get(l.id) ?? cabida(l, apilado)) > 0,
        )
        if (destino) break
      }

      if (!destino) {
        // El carril mas grande para el que mas pide. Los productos vienen en orden de
        // pronostico, y repartir al azar deja los carriles grandes de piso en manos de
        // productos de cinco pallets. En rack el carril es la pareja frente/fondo de una
        // bahia a un nivel, no la corrida entera (migracion 0093).
        let lane
        let mayor = -1
        if (quedaMargen(grupoDe(pallet))) {
          for (const id of carrilLibre) {
            if (!cabe(carriles.get(id)[0], pallet)) continue
            const cap = carriles.get(id).reduce((t, l) => t + cabida(l, apilado), 0)
            if (cap > mayor) {
              mayor = cap
              lane = id
            }
          }
        }
        if (lane !== undefined) {
          tomarCarril(lane)
          mios.set(pallet.product_id, [...suyos, lane])
          destino = ordenar(carriles.get(lane), pallet.clase)[0]
        }
      }

      if (destino) {
        const quedan = (hueco.get(destino.id) ?? cabida(destino, apilado)) - 1
        hueco.set(destino.id, quedan)
      }
    }

    // El fondo de una bahia es la reserva de la cara que tiene delante: va con su lote, o el
    // carril tendria dos y la base lo rechazaria al guardar.
    if (destino) puestos.push({ ...pallet, ...cara.get(destino.carril), location_id: destino.id })
    else sinSitio.push(pallet)
  }

  return { puestos, sinSitio }
}

/** Escribe los pallets que ya tienen posicion, por tandas: `post_movement` serializa. */
async function sembrar(puestos) {
  let hechos = 0
  for (let i = 0; i < puestos.length; i += TANDA) {
    const tanda = puestos.slice(i, i + TANDA)
    const filas = tanda
      .map(
        (p) =>
          `('${p.matricula}','${p.product_id}'::uuid,'${p.case_id}'::uuid,` +
          `${Number(p.base_pallet)},'${p.lote}','${p.vence}'::date,'${p.location_id}'::uuid)`,
      )
      .join(',')
    const r = await uno(`
      with par (matricula, product_id, case_id, base, lote, vence, loc) as (values ${filas}),
      nuevos as (
        insert into lpn (code, source, level)
        select matricula, 'INTERNO', 'PALLET' from par
        on conflict (code) do update set source = excluded.source
        returning id, code
      )
      select count(*)::int as n
      from par join nuevos on nuevos.code = par.matricula
      cross join lateral (
        select post_movement(
          'RECEIPT'::movement_type, par.product_id, par.base, null, par.loc, nuevos.id,
          par.lote, par.vence, 'CARGA_INICIAL', 'Existencia de SAP del 14/11', par.case_id
        )
      ) m`)
    hechos += r.n
    process.stdout.write(`\r  ${miles(hechos)} / ${miles(puestos.length)} pallets`)
  }
  process.stdout.write('\n')
}

/**
 * Vaciar la bodega. El libro mayor no se borra —es inmutable a proposito—, asi que la
 * existencia se deja en cero con ajustes y despues se quitan las filas vacias.
 */
async function limpiar() {
  console.log('Soltando lo apartado y las tareas abiertas')
  await sql(`
    update stock set qty_allocated = 0 where qty_allocated <> 0;
    update task set status = 'CANCELLED', completed_at = now(),
                    closed_reason = 'Bodega vaciada para sembrar la existencia de SAP'
    where status not in ('DONE', 'CANCELLED');
    delete from allocation`)

  console.log('Dejando la existencia en cero')
  for (let vueltas = 0; ; vueltas++) {
    if (vueltas > 80) throw new Error('Demasiadas vueltas vaciando')
    const r = await uno(`
      with sobra as (
        select s.id, s.product_id, s.location_id, s.lpn_id, s.lot, s.expiry_date, s.qty_base
        from stock s where s.qty_base > 0 limit ${TANDA}
      )
      select count(*)::int as n
      from sobra
      cross join lateral (
        select post_movement(
          'ADJUST'::movement_type, sobra.product_id, sobra.qty_base, sobra.location_id, null,
          sobra.lpn_id, sobra.lot, sobra.expiry_date, 'CARGA_INICIAL',
          'Bodega vaciada para sembrar la existencia de SAP'
        )
      ) m`)
    if (r.n === 0) break
    console.log(`  ${r.n} posiciones vaciadas`)
  }
  await sql('delete from stock where qty_base = 0')
  await sql('drop table if exists siembra_sap')
}

async function resumen() {
  const r = await uno(`
    select
      (select count(*)::int from stock where qty_base > 0) as posiciones,
      (select count(distinct product_id)::int from stock where qty_base > 0) as productos,
      (select sum(qty_base)::numeric from stock) as unidades,
      (select count(*)::int from stock s
        join location_area lar on lar.location_id = s.location_id and lar.valid_to is null
        join area a on a.id = lar.area_id and a.code = 'PICKING'
       where s.qty_base > 0) as en_picking`)
  console.log(
    `\nEn la bodega: ${miles(r.posiciones)} posiciones con producto · ` +
      `${miles(r.productos)} productos · ${miles(r.unidades)} unidades base · ` +
      `${miles(r.en_picking)} en picking`,
  )
}

if (process.argv.includes('--limpiar')) {
  await limpiar()
  await resumen()
} else {
  console.log('Vaciando lo que hay')
  await limpiar()

  console.log('Armando el plan desde la foto de SAP')
  const plan = await planificar()
  console.log(
    `  ${miles(plan.pallets)} pallets de ${miles(plan.productos)} productos, ` +
      `${miles(plan.unidades)} unidades base`,
  )

  console.log('Repartiendo las posiciones')
  const { puestos, sinSitio } = await repartir()
  console.log(`  ${miles(puestos.length)} con sitio · ${miles(sinSitio.length)} sin sitio`)

  console.log('Sembrando')
  await sembrar(puestos)

  if (sinSitio.length > 0) {
    const porSku = new Map()
    for (const p of sinSitio) porSku.set(p.sku, (porSku.get(p.sku) ?? 0) + 1)
    const peores = [...porSku].sort((a, b) => b[1] - a[1]).slice(0, 8)
    console.log(`\n${miles(sinSitio.length)} pallets no cupieron. Los que más:`)
    for (const [sku, n] of peores) console.log(`  ${sku}: ${miles(n)} pallets`)
  }

  await resumen()
}
