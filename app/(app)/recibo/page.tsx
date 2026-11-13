import { requirePermission } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ReceiveForm } from './receive-form'

export const metadata = { title: 'Recibo · WMS Palmerola' }

export default async function ReceivingPage() {
  await requirePermission('inventario:mover')

  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('anden_de_recibo')
    .select('location_id, anden')
    .order('anden')

  const docks = (data ?? []).map((d) => ({ id: d.location_id!, code: d.anden! }))

  return (
    <main className="flex w-full max-w-md flex-1 flex-col gap-6 p-4 pb-8">
      <h1 className="text-xl">Recibir pallet</h1>
      {docks.length > 0 ? (
        <ReceiveForm docks={docks} />
      ) : (
        <p className="text-sm text-azul/60">No hay andenes de descarga configurados.</p>
      )}
    </main>
  )
}
