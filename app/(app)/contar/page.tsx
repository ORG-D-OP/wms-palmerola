import { requireDeBodega, requireUser } from '@/lib/auth/session'
import { can } from '@/lib/auth/roles'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ContarForm, type Pendiente } from './contar-form'

export const metadata = { title: 'Contar · WMS Palmerola' }

/** Lo que le tocó a esta persona del conteo cíclico, en el orden del recorrido. */
async function misConteos(profileId: string): Promise<Pendiente[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('conteos_pendientes')
    .select('task_id, posicion, zona, nivel, pick_sequence, status')
    .eq('assigned_to', profileId)
    .order('pick_sequence', { nullsFirst: false })
    .order('posicion')

  // Lo empezado va primero y dice que lo está: quien sale de la pantalla a media posición
  // vuelve y la encuentra arriba, no la busca en la lista.
  return (data ?? [])
    .map((c) => ({
      tarea: c.task_id ?? '',
      posicion: c.posicion ?? '',
      zona: c.zona ?? '',
      nivel: c.nivel,
      empezado: c.status === 'IN_PROGRESS',
    }))
    .sort((a, b) => Number(b.empezado) - Number(a.empezado))
}

/** Lo que se lanzó sin dueño y sigue esperando en la cola. */
async function enLaCola(): Promise<number> {
  const supabase = await createSupabaseServerClient()
  const { count } = await supabase
    .from('conteos_pendientes')
    .select('task_id', { count: 'exact', head: true })
    .is('assigned_to', null)

  return count ?? 0
}

/**
 * Contar son dos oficios con dos dueños.
 *
 * La **tarea** de conteo cíclico le cae a cualquiera: se reparte como el surtido. El
 * **recuento suelto** —escanear una posición porque uno ve que hay menos de lo que el sistema
 * dice— cambia la existencia sin que nadie lo haya mandado, y eso es del jefe de bodega. Lo
 * dijo él el 12/11 y hasta hoy no se aplicaba. La base lo defiende en `recontar`; esto sólo
 * evita ofrecer un escaneo que siempre va a contestar que no.
 */
export default async function ContarPage() {
  await requireDeBodega('conteo:ejecutar')
  const user = await requireUser()
  const [pendientes, cola] = await Promise.all([misConteos(user.id), enLaCola()])

  return (
    <main className="flex w-full max-w-md flex-1 flex-col gap-6 p-4 pb-8 md:p-8">
      <h1 className="text-xl">Contar</h1>
      <ContarForm
        pendientes={pendientes}
        cola={cola}
        puedeAjustar={can(user.roles, 'inventario:ajustar')}
      />
    </main>
  )
}
