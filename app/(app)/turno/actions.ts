'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { toErrorResponse } from '@/lib/errors'
import { ROLES, ROLES_DE_TRABAJO, rolesDeTrabajoDe } from '@/lib/auth/roles'

type Fail = { ok: false; error: string }

function fallo(error: { code?: string; message: string }): Fail {
  if (error.code === 'P0001' || error.code === '23514') return { ok: false, error: error.message }
  if (error.code === '23505') return { ok: false, error: 'Ese código de equipo ya existe.' }
  return { ok: false, error: toErrorResponse(error).body.error }
}

const Turno = z.object({
  tipo: z.string().trim().max(24).optional(),
  rol: z.enum(ROLES_DE_TRABAJO).optional(),
})

export async function iniciarTurno(_prev: unknown, datos: FormData) {
  await requirePermission('turno:iniciar')

  const parsed = Turno.safeParse({
    tipo: datos.get('tipo') || undefined,
    rol: datos.get('rol') || undefined,
  })
  if (!parsed.success) return { ok: false as const, error: 'Revisa el equipo y el rol.' }

  const supabase = await createSupabaseServerClient()
  // El lado de la operación ya no se escoge: lo reparte el jefe de bodega por andén, así que
  // todo el mundo entra a los dos lados hasta que esa asignación exista. Del equipo se declara
  // el tipo, no la unidad: lo que el sistema necesita saber es hasta qué nivel alcanza.
  const { error } = await supabase.rpc('iniciar_turno', {
    p_tipo_equipo: parsed.data.tipo || undefined,
    p_rol: parsed.data.rol,
  })

  if (error) return fallo(error)
  revalidatePath('/turno')
  revalidatePath('/')
  return { ok: true as const }
}

/** Entrar sin equipo, que es el caso de casi todos. Es el botón de la pantalla de inicio. */
export async function entrarATrabajo() {
  await requirePermission('turno:iniciar')

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('iniciar_turno', {})

  if (error) return fallo(error)
  revalidatePath('/')
  revalidatePath('/turno')
  return { ok: true as const }
}

/**
 * Cambiarse de rol a media mañana. Es el supervisor que baja a ayudar cuando se acumula el
 * trabajo, y el auxiliar que cubre de chequeador. No toca el rango de nadie: los permisos se
 * quedan donde estaban, lo único que cambia es qué trabajo le da el sistema.
 */
export async function trabajarComo(rol: string) {
  const user = await requirePermission('turno:iniciar')

  // Se admite también el rango de quien manda, que es el «volver a lo mío» del que bajó a
  // ayudar. La base lo vuelve a comprobar en `puede_trabajar_como`.
  const parsed = z.enum(ROLES).safeParse(rol)
  if (!parsed.success || !rolesDeTrabajoDe(user.roles).includes(parsed.data)) {
    return { ok: false as const, error: 'Ese rol no es de trabajo.' }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('trabajar_como', { p_rol: parsed.data })

  if (error) return fallo(error)
  revalidatePath('/turno')
  revalidatePath('/')
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
  revalidatePath('/turno')
  revalidatePath('/')
}

export async function reanudarTurno() {
  await requirePermission('turno:iniciar')
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('reanudar_turno')
  if (error) throw new Error(fallo(error).error)
  revalidatePath('/turno')
  revalidatePath('/')
}

/** Accion de formulario simple: no hay nada que decidir, o cierra o revienta. */
export async function cerrarTurno() {
  await requirePermission('turno:iniciar')
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('cerrar_turno')
  if (error) throw new Error(fallo(error).error)
  revalidatePath('/turno')
  revalidatePath('/')
}

const Equipo = z.object({
  code: z.string().trim().min(1).max(20),
  tipo: z.string().trim().min(2).max(24),
})

export async function registrarEquipo(_prev: unknown, datos: FormData) {
  await requirePermission('flota:administrar')

  const parsed = Equipo.safeParse({ code: datos.get('code'), tipo: datos.get('tipo') })
  if (!parsed.success) return { ok: false as const, error: 'Revisa el código y el tipo.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('equipment')
    .insert({ code: parsed.data.code.toUpperCase(), type_code: parsed.data.tipo })

  if (error) return fallo(error)
  revalidatePath('/turno')
  return { ok: true as const }
}

export async function cambiarEstadoEquipo(datos: FormData) {
  await requirePermission('flota:administrar')

  const id = z.uuid().safeParse(datos.get('id'))
  if (!id.success) throw new Error('Equipo inválido.')

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('equipment')
    .update({ is_active: datos.get('activo') === '1' })
    .eq('id', id.data)

  if (error) throw new Error(fallo(error).error)
  revalidatePath('/turno')
}

/**
 * El jefe de bodega para a alguien en un andén, o lo suelta para toda la bodega.
 *
 * Devuelve qué pasó con su trabajo, porque eso es lo que hay que contarle: cuántas tareas
 * soltó al andén que deja, y si va a medio camino con algo que no se le puede quitar.
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
  revalidatePath('/turno')
  return {
    ok: true as const,
    anden: data?.anden ?? null,
    liberadas: data?.liberadas ?? 0,
    enCurso: data?.en_curso ?? null,
  }
}
