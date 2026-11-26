import Link from 'next/link'
import { requireUser } from '@/lib/auth/session'
import { atajos, navMovil } from '@/components/app-shell/nav-items'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Ocupacion as Estados, Segmentos } from '@/components/warehouse-canvas'
import type { Pilas } from '@/lib/warehouse/plano'
import { Icon } from '@/components/ui/icon'
import { Ocupacion } from './ocupacion'
import { Trabajo, type Trabajo as EstadoTrabajo } from './trabajo'

/**
 * La planta entera cabe en una fila. Pedirla por la vista `posicion_estado` no servía: son
 * 5,581 posiciones y PostgREST corta en `max_rows`, mil, así que el mapa pintaba una de cada
 * cuatro y la bodega llena se veía casi vacía (migración 0098).
 */
type Planta = {
  ocupadas?: string[]
  apartadas?: string[]
  otros?: string[]
  no_alimento?: string[]
  areas?: Record<string, string[]>
  pilas?: Pilas
}

async function getDatos() {
  const supabase = await createSupabaseServerClient()

  const [planta, zonas, areas, productos, tareas] = await Promise.all([
    supabase.rpc('planta'),
    supabase
      .from('zone_occupancy')
      .select('code, kind, ocupadas, total')
      .in('kind', ['floor', 'rack']),
    supabase
      .from('area_occupancy')
      .select('code, name, total, ocupadas, is_virtual')
      .eq('is_virtual', false)
      .order('code'),
    supabase.from('product').select('*', { count: 'exact', head: true }),
    supabase
      .from('task')
      .select('*', { count: 'exact', head: true })
      .in('status', ['READY', 'ASSIGNED', 'IN_PROGRESS']),
  ])

  const mapa = (planta.data ?? {}) as Planta
  const ocupacion: Estados = {}
  for (const code of mapa.otros ?? []) ocupacion[code] = 'OTRO_USO'
  for (const code of mapa.apartadas ?? []) ocupacion[code] = 'APARTADA'
  for (const code of mapa.ocupadas ?? []) ocupacion[code] = 'OCUPADA'
  const segmentos: Segmentos = {
    no_alimento: mapa.no_alimento ?? [],
    areas: mapa.areas ?? {},
  }

  const totales = (zonas.data ?? []).reduce(
    (acc, z) => ({ ocupadas: acc.ocupadas + (z.ocupadas ?? 0), total: acc.total + (z.total ?? 0) }),
    { ocupadas: 0, total: 0 },
  )

  return {
    ocupacion,
    segmentos,
    pilas: mapa.pilas ?? {},
    totales,
    areas: (areas.data ?? []).filter((a) => (a.total ?? 0) > 0),
    productos: productos.count ?? 0,
    tareas: tareas.count ?? 0,
  }
}

/** Si está disponible o no. Es lo primero de la pantalla porque sin eso no le cae trabajo. */
async function getTrabajo(profileId: string): Promise<EstadoTrabajo | null> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('mi_trabajo')
    .select('equipo, paused_at, pause_note')
    .eq('profile_id', profileId)
    .maybeSingle()

  if (!data) return null
  return {
    equipo: data.equipo,
    pausado: data.paused_at !== null,
    motivo: data.pause_note,
  }
}

export default async function DashboardPage() {
  const user = await requireUser()
  const [{ ocupacion, segmentos, pilas, totales, areas, productos, tareas }, trabajo] =
    await Promise.all([getDatos(), getTrabajo(user.id)])
  const libres = totales.total - totales.ocupadas
  const pct = totales.total > 0 ? Math.round((totales.ocupadas / totales.total) * 100) : 0

  const accesos = atajos(user.roles, { rol: user.workingRole, enMano: user.tareasEnMano })
  const enLaBarra = new Set(
    navMovil(user.roles, { rol: user.workingRole, enMano: user.tareasEnMano }).map((i) => i.href),
  )
  // En el teléfono el tablero es el índice de lo que la barra de abajo no lleva; en pantalla
  // grande la lateral ya lo lleva todo, así que sólo quedan las de mano, en pequeño.
  const enElTablero = accesos.filter((a) => !enLaBarra.has(a.href))
  const rapidos = accesos.filter((a) => a.movil)

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-8 md:gap-0 md:p-0">
      <div className="contents md:flex md:items-center md:gap-4 md:border-b md:border-borde md:px-8 md:py-3.5">
        <h1 className="text-2xl md:text-xl">Hola, {user.fullName.split(' ')[0]}</h1>

        <div className="ml-auto hidden gap-2 lg:flex">
          {rapidos.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="flex items-center gap-2 rounded-xl border border-borde px-3.5 py-2 text-sm transition-colors hover:bg-azul-08"
            >
              <Icon name={a.icon} className="!text-[18px]" />
              {a.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="contents md:flex md:flex-col md:gap-6 md:p-8 xl:grid xl:grid-cols-[minmax(0,1fr)_21rem] xl:grid-rows-[auto_auto_1fr] xl:items-start">
        <div className="contents xl:col-start-2 xl:row-start-1 xl:block">
          {/* Al montacarguista no se le puede entrar sin máquina: hay que saber si va de piso
              o de rack, porque son tareas distintas. Ese escoge en Disponibilidad. */}
          <Trabajo trabajo={trabajo} montacarguista={user.role === 'montacargista'} />
        </div>

        {enElTablero.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 md:hidden">
            {enElTablero.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="flex flex-col gap-2 rounded-2xl bg-azul p-4 text-white transition-opacity hover:opacity-90"
              >
                <Icon name={a.icon} />
                <span className="text-lg">{a.label}</span>
              </Link>
            ))}
          </div>
        ) : null}

        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:col-start-2 xl:row-start-2 xl:grid-cols-2">
          {[
            { label: 'Posiciones libres', valor: libres, icono: 'inventory', nota: null },
            {
              label: 'Ocupadas',
              valor: totales.ocupadas,
              icono: 'pallet',
              nota: `${pct}% del almacén`,
            },
            { label: 'Tareas abiertas', valor: tareas, icono: 'assignment', nota: null },
            { label: 'Productos', valor: productos, icono: 'category', nota: 'en datos maestros' },
          ].map((t) => (
            <div key={t.label} className="rounded-2xl border border-borde p-4">
              <dt className="flex items-center gap-1.5 text-xs text-azul/60">
                <Icon name={t.icono} className="!text-[18px]" />
                {t.label}
              </dt>
              <dd className="mt-1 text-2xl tabular-nums">{t.valor.toLocaleString('es-HN')}</dd>
              {t.nota ? <dd className="text-xs text-azul/50">{t.nota}</dd> : null}
            </div>
          ))}
        </dl>

        <div className="contents xl:col-start-1 xl:row-start-1 xl:row-end-4 xl:block">
          {/*
            El 3D es sólo mirar, así que lo ve cualquiera que entre al tablero. Estaba colgado
            de `kpi:ver`, que es el permiso de los indicadores: auxiliares, montacarguistas y
            chequeadores no tenían siquiera el botón.
          */}
          <Ocupacion estados={ocupacion} segmentos={segmentos} pilas={pilas} permite3D />
        </div>

        {areas.length > 0 ? (
          <section className="flex flex-col gap-2 xl:col-start-2 xl:row-start-3 xl:rounded-2xl xl:border xl:border-borde xl:p-5">
            <h2 className="text-lg">Por área</h2>
            <ul className="flex flex-col divide-y divide-borde">
              {areas.map((a) => {
                const total = a.total ?? 0
                const ocupadas = a.ocupadas ?? 0
                const porcentaje = total > 0 ? Math.round((ocupadas / total) * 100) : 0
                return (
                  <li key={a.code} className="flex flex-col gap-1.5 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate">{a.name}</span>
                      <span className="shrink-0 text-sm tabular-nums text-azul/70">
                        {ocupadas.toLocaleString('es-HN')} de {total.toLocaleString('es-HN')}
                      </span>
                    </div>
                    <div
                      className="h-1.5 overflow-hidden rounded-full bg-azul-08"
                      role="img"
                      aria-label={`${porcentaje}% ocupada`}
                    >
                      <div className="h-full bg-azul" style={{ width: `${porcentaje}%` }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </main>
  )
}
