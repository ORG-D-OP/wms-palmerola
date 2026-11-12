import Link from 'next/link'
import { requireUser } from '@/lib/auth/session'
import { can } from '@/lib/auth/roles'
import { atajos, navMovil } from '@/components/app-shell/nav-items'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Ocupacion as Estados } from '@/components/warehouse-canvas'
import { Icon } from '@/components/ui/icon'
import { Ocupacion } from './ocupacion'
import { Trabajo, type Trabajo as EstadoTrabajo } from './trabajo'

/** Con la bodega llena son 5,581 códigos cortos; con la bodega vacía, ninguno. */
const TOPE_POSICIONES = 6000

async function getDatos() {
  const supabase = await createSupabaseServerClient()

  const [estados, zonas, areas, productos, tareas] = await Promise.all([
    supabase.from('posicion_estado').select('code, estado').limit(TOPE_POSICIONES),
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

  const ocupacion = Object.fromEntries(
    (estados.data ?? []).map((p) => [p.code ?? '', p.estado ?? 'OCUPADA']),
  ) as Estados

  const totales = (zonas.data ?? []).reduce(
    (acc, z) => ({ ocupadas: acc.ocupadas + (z.ocupadas ?? 0), total: acc.total + (z.total ?? 0) }),
    { ocupadas: 0, total: 0 },
  )

  return {
    ocupacion,
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
  const [{ ocupacion, totales, areas, productos, tareas }, trabajo] = await Promise.all([
    getDatos(),
    getTrabajo(user.id),
  ])
  const libres = totales.total - totales.ocupadas
  const pct = totales.total > 0 ? Math.round((totales.ocupadas / totales.total) * 100) : 0

  const accesos = atajos(user.roles)
  const enLaBarra = new Set(navMovil(user.roles).map((i) => i.href))

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-8">
      <h1 className="text-2xl">Hola, {user.fullName.split(' ')[0]}</h1>

      <Trabajo trabajo={trabajo} />

      {accesos.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 md:max-w-xl md:grid-cols-4">
          {accesos.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className={`flex-col gap-2 rounded-2xl bg-azul p-4 text-white transition-opacity hover:opacity-90 ${
                enLaBarra.has(a.href) ? 'hidden md:flex' : a.movil ? 'flex' : 'flex md:hidden'
              }`}
            >
              <Icon name={a.icon} />
              <span className="text-lg">{a.label}</span>
            </Link>
          ))}
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: 'Posiciones libres', valor: libres, icono: 'inventory', nota: null },
          { label: 'Ocupadas', valor: totales.ocupadas, icono: 'pallet', nota: `${pct}% del almacén` },
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

      <Ocupacion estados={ocupacion} permite3D={can(user.roles, 'kpi:ver')} />

      {areas.length > 0 ? (
        <section className="flex flex-col gap-2">
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
    </main>
  )
}
