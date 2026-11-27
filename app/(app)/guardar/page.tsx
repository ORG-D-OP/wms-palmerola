import { requireDeBodega } from '@/lib/auth/session'
import { can } from '@/lib/auth/roles'
import { PutawayForm } from './putaway-form'

export const metadata = { title: 'Guardar · WMS Palmerola' }

export default async function PutawayPage() {
  const user = await requireDeBodega('inventario:mover')

  return (
    <main className="flex w-full max-w-md flex-1 flex-col gap-6 p-4 pb-8 md:p-8">
      <h1 className="text-xl">Guardar pallet</h1>
      <PutawayForm puedeCerrar={can(user.roles, 'tareas:reasignar')} />
    </main>
  )
}
