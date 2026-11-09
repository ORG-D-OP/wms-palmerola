import { requirePermission } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { RetornablesForm } from './retornables-form'

export const metadata = { title: 'Retornables · WMS Palmerola' }

export default async function RetornablesPage() {
  await requirePermission('inventario:mover')

  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('retornables')
    .select('code, uso, cantidad')
    .gt('cantidad', 0)
    .order('code')

  const espacios = data ?? []

  return (
    <main className="flex w-full max-w-md flex-1 flex-col gap-6 p-4 pb-8">
      <h1 className="text-xl">Pallets vacíos y corrugado</h1>
      <RetornablesForm />

      {espacios.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm text-azul/60">Lo que hay ahora</h2>
          <ul className="flex flex-col divide-y divide-borde text-sm">
            {espacios.map((e) => (
              <li key={e.code} className="flex items-baseline gap-3 py-2">
                <span className="w-28 shrink-0 tabular-nums">{e.code}</span>
                <span className="min-w-0 flex-1 truncate text-azul/60">{e.uso}</span>
                <span className="tabular-nums">{Number(e.cantidad).toLocaleString('es-HN')}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  )
}
