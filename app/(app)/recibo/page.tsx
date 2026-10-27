import { requirePermission } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ReceiveForm } from './receive-form'

export const metadata = { title: 'Recibo · WMS Palmerola' }

export default async function ReceivingPage() {
  await requirePermission('inventario:mover')

  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('location')
    .select('id, code')
    .eq('kind', 'staging')
    .like('code', 'STG-AND-N-%')
    .order('code')

  const docks = (data ?? []).map((d) => ({ id: d.id, code: d.code.replace('STG-', '') }))

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
