import { requirePermission } from '@/lib/auth/session'
import { ReordenarForm } from './reordenar-form'

export const metadata = { title: 'Reordenar · WMS Palmerola' }

export default async function ReordenarPage() {
  await requirePermission('inventario:mover')

  return (
    <main className="flex w-full max-w-md flex-1 flex-col gap-6 p-4 pb-8">
      <h1 className="text-xl">Reordenar</h1>
      <ReordenarForm />
    </main>
  )
}
