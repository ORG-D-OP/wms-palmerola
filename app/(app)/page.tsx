import Link from 'next/link'
import { requireUser } from '@/lib/auth/session'
import { can } from '@/lib/auth/roles'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { WarehouseCanvas, type Ocupacion } from '@/components/warehouse-canvas'
import { Icon } from '@/components/ui/icon'

async function getDatos() {
  const supabase = await createSupabaseServerClient()

  const [zonas, productos, tareas] = await Promise.all([
    supabase.from('zone_occupancy').select('code, kind, ocupadas, total').in('kind', ['floor', 'rack']),
    supabase.from('product_readiness').select('*', { count: 'exact', head: true }),
    supabase
      .from('task')
      .select('*', { count: 'exact', head: true })
      .in('status', ['READY', 'ASSIGNED', 'IN_PROGRESS']),
  ])

  const ocupacion: Ocupacion = Object.fromEntries(
    (zonas.data ?? []).map((z) => [z.code, { ocupadas: z.ocupadas ?? 0, total: z.total ?? 0 }]),
  )
  const totales = (zonas.data ?? []).reduce(
    (acc, z) => ({ ocupadas: acc.ocupadas + (z.ocupadas ?? 0), total: acc.total + (z.total ?? 0) }),
    { ocupadas: 0, total: 0 },
  )

  return { ocupacion, totales, productos: productos.count ?? 0, tareas: tareas.count ?? 0 }
}

export default async function DashboardPage() {
  const user = await requireUser()
  const { ocupacion, totales, productos, tareas } = await getDatos()
  const libres = totales.total - totales.ocupadas

  const accesos = [
    { href: '/recibo', label: 'Recibir', icon: 'move_to_inbox', permiso: 'inventario:mover' },
    { href: '/guardar', label: 'Guardar', icon: 'shelves', permiso: 'inventario:mover' },
  ] as const

  const disponibles = accesos.filter((a) => can(user.role, a.permiso))

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-8">
      <h1 className="text-2xl">Hola, {user.fullName.split(' ')[0]}</h1>

      {disponibles.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 md:max-w-md">
          {disponibles.map((a) => (
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

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: 'Posiciones libres', valor: libres, icono: 'inventory' },
          { label: 'Ocupadas', valor: totales.ocupadas, icono: 'pallet' },
          { label: 'Tareas abiertas', valor: tareas, icono: 'assignment' },
          { label: 'Productos', valor: productos, icono: 'category' },
        ].map((t) => (
          <div key={t.label} className="rounded-2xl border border-borde p-4">
            <dt className="flex items-center gap-1.5 text-xs text-azul/60">
              <Icon name={t.icono} className="!text-[18px]" />
              {t.label}
            </dt>
            <dd className="mt-1 text-2xl tabular-nums">{t.valor.toLocaleString('es-HN')}</dd>
          </div>
        ))}
      </dl>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg">Ocupación del almacén</h2>
        <p className="text-sm text-azul/60">
          Arrastra para mover, rueda o pellizca para acercar.
        </p>
        <WarehouseCanvas ocupacion={ocupacion} />
      </section>
    </main>
  )
}
