import { requireUser } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'

async function getCounts() {
  const supabase = await createSupabaseServerClient()
  const [locations, products, stock] = await Promise.all([
    supabase.from('location').select('*', { count: 'exact', head: true }).is('retired_at', null),
    supabase.from('product').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('stock').select('*', { count: 'exact', head: true }).gt('qty_base', 0),
  ])
  return {
    posiciones: locations.count ?? 0,
    productos: products.count ?? 0,
    ocupadas: stock.count ?? 0,
  }
}

export default async function DashboardPage() {
  const user = await requireUser()
  const counts = await getCounts()

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Hola, {user.fullName.split(' ')[0]}</h1>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Object.entries(counts).map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-black/10 p-4 dark:border-white/15"
          >
            <dt className="text-xs uppercase tracking-wide opacity-60">{label}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{value.toLocaleString('es-HN')}</dd>
          </div>
        ))}
      </dl>
    </main>
  )
}
