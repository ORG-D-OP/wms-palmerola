import Link from 'next/link'
import { requirePermission } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NewOrder } from './new-order'
import { ESTADO } from './estado'

export const metadata = { title: 'Pedidos · WMS Palmerola' }

export default async function OrdersPage() {
  await requirePermission('pedidos:administrar')
  const supabase = await createSupabaseServerClient()

  const [{ data: pedidos }, { data: andenes }] = await Promise.all([
    supabase
      .from('sales_order')
      .select('id, code, customer, status, created_at, dock_door(code)')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('dock_door').select('id, code').eq('direction', 'outbound').order('code'),
  ])

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-8">
      <h1 className="text-xl">Pedidos</h1>

      <NewOrder andenes={andenes ?? []} />

      <ul className="flex flex-col divide-y divide-borde">
        {(pedidos ?? []).map((p) => (
          <li key={p.id}>
            <Link href={`/pedidos/${p.id}`} className="flex items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{p.code}</span>
                <span className="block text-sm text-azul/60">
                  {p.customer ?? 'sin cliente'} · {p.dock_door?.code ?? 'sin andén'}
                </span>
              </span>
              <span className="shrink-0 rounded-md bg-azul-08 px-2 py-1 text-xs">
                {ESTADO[p.status]}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {(pedidos ?? []).length === 0 ? <p className="text-azul/60">Todavía no hay pedidos.</p> : null}
    </main>
  )
}
