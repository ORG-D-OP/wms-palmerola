import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/roles'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { IngresoForm } from './ingreso-form'
import { buscarIngreso } from './actions'

export const metadata = { title: 'Ingreso · WMS Palmerola' }

export default async function IngresoPage() {
  const user = await requirePermission('inventario:mover')

  const supabase = await createSupabaseServerClient()
  const [{ data }, { data: enCurso }] = await Promise.all([
    supabase.from('anden_de_recibo').select('location_id, anden').order('anden'),
    supabase.rpc('ingreso_en_curso'),
  ])

  const docks = (data ?? []).map((d) => ({ id: d.location_id!, code: d.anden! }))

  // El camión a medio descargar se vuelve a abrir aquí, en el servidor: la pantalla ya llega
  // con él puesto y la persona sigue donde lo dejó, sin escanear el pedido otra vez.
  const abierto = enCurso ? await buscarIngreso(enCurso) : null

  return (
    <main className="flex w-full max-w-md flex-1 flex-col gap-6 p-4 pb-8 md:p-8">
      <h1 className="text-xl">Recibir camión</h1>
      {docks.length > 0 ? (
        <IngresoForm
          docks={docks}
          anden={user.anden}
          abierto={abierto?.ok ? abierto.doc : null}
          deAnden={can(user.roles, 'ingresos:administrar')}
        />
      ) : (
        <p className="text-sm text-azul/60">No hay andenes de descarga configurados.</p>
      )}
    </main>
  )
}
