import { requirePermission } from '@/lib/auth/session'
import { PickForm } from './pick-form'

export const metadata = { title: 'Surtir · WMS Palmerola' }

export default async function PickPage() {
  await requirePermission('surtido:ejecutar')

  return (
    <main className="flex w-full max-w-md flex-1 flex-col gap-6 p-4 pb-8">
      <h1 className="text-xl">Surtir pedido</h1>
      <PickForm />
    </main>
  )
}
