import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

type Supabase = SupabaseClient<Database>

type Tipo = Database['public']['Enums']['task_type']

/**
 * Por qué no le cayó nada.
 *
 * Las pantallas de trabajo decían «No hay nada que surtir ahora» siempre que la cola no
 * soltaba nada, y casi nunca era verdad: había de sobra, pero en un nivel que ese equipo no
 * alcanza, del otro lado de la operación, o en otro andén. La persona se quedaba parada
 * creyendo que la bodega estaba al día, y el jefe sin saber que tenía a alguien de brazos
 * cruzados con trabajo en la lista.
 *
 * `task_queue` ya dice de cada tarea pendiente si está al alcance y si es del flujo de quien
 * mira, así que la respuesta se puede dar sin inventarla.
 */
export async function porQueNoHayNada(
  supabase: Supabase,
  tipo: Tipo,
  oficio: string,
): Promise<string> {
  const { data } = await supabase
    .from('task_queue')
    .select('al_alcance, de_mi_flujo')
    .eq('type', tipo)

  const cola = data ?? []
  if (cola.length === 0) return `No hay nada que ${oficio} ahora.`

  const delFlujo = cola.filter((t) => t.de_mi_flujo)
  if (delFlujo.length === 0) {
    return `Lo que queda por ${oficio} es del otro lado de la operación. Si te toca, cámbiate de lado al entrar a trabajo.`
  }

  const alAlcance = delFlujo.filter((t) => t.al_alcance)
  if (alAlcance.length === 0) {
    return `Queda trabajo por ${oficio}, pero está en alturas que tu equipo no alcanza. Avisa al jefe para que lo tome un montacarguista de rack.`
  }

  // Al alcance y del flujo, y aun así la cola no suelta nada: lo que queda es de otro andén.
  return `Queda trabajo por ${oficio}, pero no en tu andén. Si tienes que atender otro, pídele al jefe que te mueva.`
}
