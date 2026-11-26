import { requirePermission } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { plural } from '@/lib/plural'
import { CargaForm } from './carga-form'

export const metadata = { title: 'Carga inicial · WMS Palmerola' }

export default async function CargaInicialPage() {
  await requirePermission('inventario:mover')

  const supabase = await createSupabaseServerClient()
  // Matrículas, no movimientos, y sin la siembra: la cuenta a pelo decía «157,258 pallets» en
  // una bodega donde caben 5,283. La función 0106 explica por qué no se puede contar aquí.
  const { data: cargados } = await supabase.rpc('pallets_de_carga_inicial')
  const count = Number(cargados ?? 0)

  return (
    <main className="flex w-full max-w-md flex-1 flex-col gap-6 p-4 pb-8 md:p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl">Carga inicial</h1>
        <p className="text-sm text-azul/60">
          Para meter al sistema el producto que ya está en la bodega. No es un ingreso: no hay
          camión, no hay tabulado y no pasa por el andén, queda directo en su posición.
        </p>
      </header>

      <CargaForm />

      {count > 0 ? (
        <p className="text-sm text-azul/60">
          {plural(count, 'pallet cargado', 'pallets cargados')} hasta ahora.
        </p>
      ) : null}
    </main>
  )
}
