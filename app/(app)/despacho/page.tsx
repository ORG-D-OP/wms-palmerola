import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/roles'
import { DespachoForm } from './despacho-form'

export const metadata = { title: 'Despacho · WMS Palmerola' }

/**
 * La hoja de despacho, hermana de la de ingreso, y la ve la misma gente: quien está en el
 * andén escanea el tabulado y va sacando. Lo único que no es de todos es **cerrar el
 * camión**, que es el momento en que el producto sale del inventario: eso lo hace quien
 * tiene la hoja en la mano y verifica, el chequeador.
 */
export default async function DespachoPage() {
  const user = await requirePermission('inventario:mover')

  return (
    <main className="flex w-full max-w-md flex-1 flex-col gap-6 p-4 pb-8">
      <h1 className="text-xl">Despachar camión</h1>
      <DespachoForm puedeCerrar={can(user.roles, 'despachos:administrar')} />
    </main>
  )
}
