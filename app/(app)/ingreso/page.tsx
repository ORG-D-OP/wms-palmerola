import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/roles'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { IngresoForm } from './ingreso-form'

export const metadata = { title: 'Ingreso · WMS Palmerola' }

export default async function IngresoPage() {
  const user = await requirePermission('inventario:mover')

  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('anden_de_recibo')
    .select('location_id, anden')
    .order('anden')

  const docks = (data ?? []).map((d) => ({ id: d.location_id!, code: d.anden! }))

  return (
    <main className="flex w-full max-w-md flex-1 flex-col gap-6 p-4 pb-8">
      <h1 className="text-xl">Recibir camión</h1>
      {docks.length > 0 ? (
        <IngresoForm docks={docks} puedeSinAviso={can(user.roles, 'ingresos:administrar')} />
      ) : (
        <p className="text-sm text-azul/60">No hay andenes de descarga configurados.</p>
      )}
    </main>
  )
}
