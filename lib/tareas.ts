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
    .select('al_alcance, de_mi_flujo, de_mi_equipo')
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

  // Las dos razones del equipo se cuentan al revés una de la otra, así que no se pueden
  // juntar: al que anda a pie lo que queda le está demasiado alto, y al que anda con el
  // montacargas de rack le queda demasiado bajo. Decirle «no lo alcanzas» al de rack cuando
  // lo que sobra es trabajo de piso sería mandarlo a buscar al que ya es.
  const deMiEquipo = alAlcance.filter((t) => t.de_mi_equipo)
  if (deMiEquipo.length === 0) {
    return `Lo que queda por ${oficio} es de piso, y andas con el montacargas de rack. Si te toca el piso, cámbiate de máquina en Disponibilidad.`
  }

  /*
    Del flujo y de su equipo, y aun así la cola no suelta nada: lo que queda es de otro andén.

    Y estos dos mensajes mandaban a buscar al jefe para dos cosas que la persona hace sola. El
    de la máquina estaba mal desde siempre —`cambiar_equipo` no pide rango— y el del andén se
    quedó mal con la 0120, que le dio a cada quien su propio selector. Son los dos mensajes que
    salen justo cuando alguien está parado sin trabajo: mandarlo a caminar a buscar al jefe
    cuando la salida son dos toques en su teléfono es el peor momento para equivocarse.
  */
  return `Queda trabajo por ${oficio}, pero no en tu andén. Si tienes que atender otro, cámbiate de andén en Disponibilidad.`
}
