import { requirePermission, requireUser } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ContarForm, type Pendiente } from './contar-form'

export const metadata = { title: 'Contar · WMS Palmerola' }

/** Lo que le tocó a esta persona del conteo cíclico, en el orden del recorrido. */
async function misConteos(profileId: string): Promise<Pendiente[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('conteos_pendientes')
    .select('task_id, posicion, zona, nivel, pick_sequence')
    .eq('assigned_to', profileId)
    .order('pick_sequence', { nullsFirst: false })
    .order('posicion')

  return (data ?? []).map((c) => ({
    tarea: c.task_id ?? '',
    posicion: c.posicion ?? '',
    zona: c.zona ?? '',
    nivel: c.nivel,
  }))
}

export default async function ContarPage() {
  await requirePermission('conteo:ejecutar')
  const user = await requireUser()
  const pendientes = await misConteos(user.id)

  return (
    <main className="flex w-full max-w-md flex-1 flex-col gap-6 p-4 pb-8">
      <h1 className="text-xl">Contar</h1>
      <ContarForm pendientes={pendientes} />
    </main>
  )
}
