import { requirePermission } from '@/lib/auth/session'
import { PutawayForm } from './putaway-form'

export const metadata = { title: 'Guardar · WMS Palmerola' }

export default async function PutawayPage() {
  await requirePermission('inventario:mover')

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 p-4">
      <h1 className="text-xl font-semibold">Guardar pallet</h1>
      <PutawayForm />
    </main>
  )
}
