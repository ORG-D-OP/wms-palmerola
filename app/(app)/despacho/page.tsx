import { requirePermission } from '@/lib/auth/session'
import { DespachoForm } from './despacho-form'

export const metadata = { title: 'Despacho · WMS Palmerola' }

/**
 * La hoja de despacho, hermana de la de ingreso. Ingreso abre un camion para recibirlo;
 * esta lo abre para cargarlo y cerrarlo.
 */
export default async function DespachoPage() {
  await requirePermission('despachos:administrar')

  return (
    <main className="flex w-full max-w-md flex-1 flex-col gap-6 p-4 pb-8">
      <h1 className="text-xl">Despachar camión</h1>
      <DespachoForm />
    </main>
  )
}
