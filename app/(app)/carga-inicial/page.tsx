import { requirePermission } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { CargaForm } from './carga-form'

export const metadata = { title: 'Carga inicial · WMS Palmerola' }

export default async function CargaInicialPage() {
  await requirePermission('inventario:mover')

  const supabase = await createSupabaseServerClient()
  const { count } = await supabase
    .from('stock_movement')
    .select('id', { count: 'exact', head: true })
    .eq('reason_code', 'CARGA_INICIAL')

  return (
    <main className="flex w-full max-w-md flex-1 flex-col gap-6 p-4 pb-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl">Carga inicial</h1>
        <p className="text-sm text-azul/60">
          Para meter al sistema el producto que ya está en la bodega. No es un ingreso: no hay
          camión, no hay tabulado y no pasa por el andén, queda directo en su posición.
        </p>
      </header>

      <CargaForm />

      {count ? (
        <p className="text-sm text-azul/60">
          {count.toLocaleString('es-HN')} {count === 1 ? 'pallet cargado' : 'pallets cargados'}{' '}
          hasta ahora.
        </p>
      ) : null}
    </main>
  )
}
