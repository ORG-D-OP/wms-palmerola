'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { toErrorResponse } from '@/lib/errors'
import { ROLES, rolesDeTrabajoDe } from '@/lib/auth/roles'

type Fail = { ok: false; error: string }

/**
 * Entrar a trabajo, cambiar de rol o que el jefe lo mueva de andén cambia lo que la persona
 * ve en toda la aplicación: el andén de la barra de arriba, qué pantallas le salen abajo y
 * qué camión retoma en Ingreso y en Despacho. Eso vive en el armazón, y `revalidatePath` sin
 * más sólo alcanza a la página: el andén de la barra se quedaba con el de antes hasta que la
 * persona recargara a mano.
 */
const refrescar = () => revalidatePath('/', 'layout')

function fallo(error: { code?: string; message: string }): Fail {
  if (error.code === 'P0001' || error.code === '23514') return { ok: false, error: error.message }
  if (error.code === '23505') return { ok: false, error: 'Ese código de equipo ya existe.' }
  return { ok: false, error: toErrorResponse(error).body.error }
}

/**
 * El rol con el que se entra a trabajo es cualquiera de los que la persona puede tomar, **el
 * suyo incluido**: el jefe que entra a trabajo entra como jefe. Aquí sólo se aceptaban los tres
 * de bodega, así que el selector ofrecía «Administrador» o «Supervisor» de primero y entrar con
 * eso devolvía «revisa el equipo y el rol». La misma regla que `trabajarComo`, que sí estaba
 * bien: vale lo que `rolesDeTrabajoDe` le permita.
 */
const Turno = z.object({
  tipo: z.string().trim().max(24).optional(),
  rol: z.enum(ROLES).optional(),
})

export async function iniciarTurno(_prev: unknown, datos: FormData) {
  const user = await requirePermission('turno:iniciar')

  const parsed = Turno.safeParse({
    tipo: datos.get('tipo') || undefined,
    rol: datos.get('rol') || undefined,
  })
  if (!parsed.success) return { ok: false as const, error: 'Revisa el equipo y el rol.' }
  if (parsed.data.rol && !rolesDeTrabajoDe(user.roles).includes(parsed.data.rol)) {
    return { ok: false as const, error: 'Ese rol no es de trabajo.' }
  }

  const supabase = await createSupabaseServerClient()
  // El lado de la operación ya no se escoge: lo reparte el jefe de bodega por andén, así que
  // todo el mundo entra a los dos lados hasta que esa asignación exista. Del equipo se declara
  // el tipo, no la unidad: lo que el sistema necesita saber es hasta qué nivel alcanza.
  const { error } = await supabase.rpc('iniciar_turno', {
    p_tipo_equipo: parsed.data.tipo || undefined,
    p_rol: parsed.data.rol,
  })

  if (error) return fallo(error)
  refrescar()
  return { ok: true as const }
}

/**
 * Entrar sin equipo, que es el caso de casi todos. Es el botón de la pantalla de inicio.
 *
 * Al montacarguista la base se lo rechaza, porque sin máquina no se sabe si es de piso o de
 * rack. A él la pantalla de inicio no le ofrece este botón: lo manda a Disponibilidad, que es
 * donde se escoge la máquina.
 */
export async function entrarATrabajo() {
  await requirePermission('turno:iniciar')

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('iniciar_turno', {})

  if (error) return fallo(error)
  refrescar()
  return { ok: true as const }
}

/**
 * Cambiarse de rol a media mañana. Es el supervisor que baja a ayudar cuando se acumula el
 * trabajo, y el auxiliar que cubre de chequeador. No toca el rango de nadie: los permisos se
 * quedan donde estaban, lo único que cambia es qué trabajo le da el sistema.
 *
 * El montacargas va con el rol y en la misma llamada: de montacarguista no se trabaja «en
 * general», o es de piso o es de rack, y son tareas distintas. Por eso el botón ya trae la
 * máquina y no hay un paso intermedio que preguntarla.
 */
export async function trabajarComo(rol: string, tipo?: string) {
  const user = await requirePermission('turno:iniciar')

  // Se admite también el rango de quien manda, que es el «volver a lo mío» del que bajó a
  // ayudar. La base lo vuelve a comprobar en `puede_trabajar_como`.
  const parsed = z.enum(ROLES).safeParse(rol)
  if (!parsed.success || !rolesDeTrabajoDe(user.roles).includes(parsed.data)) {
    return { ok: false as const, error: 'Ese rol no es de trabajo.' }
  }
  const equipo = z.string().trim().max(24).safeParse(tipo ?? '')
  if (!equipo.success) return { ok: false as const, error: 'Revisa el equipo.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('trabajar_como', {
    p_rol: parsed.data,
    p_tipo_equipo: equipo.data || undefined,
  })

  if (error) return fallo(error)
  refrescar()
  return { ok: true as const }
}

/**
 * Cambiar de montacargas sin salir del turno.
 *
 * Es el supervisor que, cuando no llegó el de rack, le cambia de puesto a alguien y le da la
 * máquina especial. Antes el equipo era de sólo lectura dentro del turno: había que salir y
 * volver a entrar, y en el camino se perdía el andén y el rol con el que andaba.
 */
export async function cambiarEquipo(tipo: string) {
  await requirePermission('turno:iniciar')

  const equipo = z.string().trim().min(1).max(24).safeParse(tipo)
  if (!equipo.success) return { ok: false as const, error: 'Revisa el equipo.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('cambiar_equipo', { p_tipo_equipo: equipo.data })

  if (error) return fallo(error)
  refrescar()
  return { ok: true as const }
}

/**
 * Me cambio de andén.
 *
 * Lo dice quien se mueve, no el jefe: el andén decide qué cola le da trabajo, y quien acaba
 * en el 9 y se va al 12 no tiene por qué esperar a que lo muevan. Sin código, «toda la
 * bodega». Lo que tenía asignado y no había empezado vuelve a la cola del andén que deja.
 */
export async function cambiarAnden(anden: string) {
  await requirePermission('turno:iniciar')

  const codigo = z.string().trim().max(20).safeParse(anden)
  if (!codigo.success) return { ok: false as const, error: 'Revisa el andén.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .rpc('cambiar_anden', { p_anden: codigo.data || undefined })
    .single()

  if (error) return fallo(error)
  refrescar()
  return {
    ok: true as const,
    anden: data?.anden ?? null,
    liberadas: data?.liberadas ?? 0,
  }
}

const Devolucion = z.object({
  taskId: z.uuid(),
  razon: z.string().trim().min(4, 'Escribe por qué vuelve a la cola.').max(200),
})

/**
 * El jefe devuelve a la cola una tarea que alguien empezó y no va a terminar.
 *
 * No la cancela: la tarea sigue viva, con su pallet y su destino, y se la lleva el siguiente
 * que pida trabajo en ese andén. Lo único que se deshace es de quién es — y con eso la persona
 * deja de estar anclada a ese andén.
 */
export async function devolverTarea(datos: z.input<typeof Devolucion>) {
  await requirePermission('tareas:reasignar')

  const parsed = Devolucion.safeParse(datos)
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('devolver_tarea', {
    p_task_id: parsed.data.taskId,
    p_razon: parsed.data.razon,
  })

  if (error) return fallo(error)
  refrescar()
  return { ok: true as const }
}

export async function pausarTurno(datos: FormData) {
  await requirePermission('turno:iniciar')

  const motivo = z.string().trim().max(200).safeParse(datos.get('motivo') ?? '')
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('pausar_turno', {
    p_motivo: motivo.success && motivo.data ? motivo.data : undefined,
  })

  if (error) throw new Error(fallo(error).error)
  refrescar()
}

export async function reanudarTurno() {
  await requirePermission('turno:iniciar')
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('reanudar_turno')
  if (error) throw new Error(fallo(error).error)
  refrescar()
}

/** Accion de formulario simple: no hay nada que decidir, o cierra o revienta. */
export async function cerrarTurno() {
  await requirePermission('turno:iniciar')
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('cerrar_turno')
  if (error) throw new Error(fallo(error).error)
  refrescar()
}

/**
 * El jefe de bodega para a alguien en un andén, o lo suelta para toda la bodega.
 *
 * Devuelve cuántas tareas soltó al andén que deja, porque eso es lo que hay que contarle. Si
 * la persona anda a medio camino con algo, el cambio no pasa y vuelve como error, con el
 * sitio donde está esa tarea.
 */
export async function asignarAnden(personaId: string, anden: string) {
  await requirePermission('tareas:reasignar')

  const persona = z.uuid().safeParse(personaId)
  if (!persona.success) return { ok: false as const, error: 'Persona inválida.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .rpc('asignar_anden', {
      p_profile_id: persona.data,
      p_anden: anden.trim() || undefined,
    })
    .single()

  if (error) return fallo(error)
  refrescar()
  return {
    ok: true as const,
    anden: data?.anden ?? null,
    liberadas: data?.liberadas ?? 0,
  }
}
