'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { toErrorResponse } from '@/lib/errors'

type Fail = { ok: false; error: string }

function fallo(error: { code?: string; message: string }): Fail {
  if (error.code === 'P0001' || error.code === '23514') return { ok: false, error: error.message }
  if (error.code === '23505') return { ok: false, error: 'Ese código de equipo ya existe.' }
  return { ok: false, error: toErrorResponse(error).body.error }
}

const Turno = z.object({
  equipo: z.string().trim().max(20).optional(),
  flujo: z.enum(['INBOUND', 'OUTBOUND', 'BOTH']),
})

export async function iniciarTurno(_prev: unknown, datos: FormData) {
  await requirePermission('turno:iniciar')

  const parsed = Turno.safeParse({
    equipo: datos.get('equipo') || undefined,
    flujo: datos.get('flujo'),
  })
  if (!parsed.success) return { ok: false as const, error: 'Revisa el equipo y el flujo.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('iniciar_turno', {
    p_equipment_code: parsed.data.equipo || undefined,
    p_flow: parsed.data.flujo,
  })

  if (error) return fallo(error)
  revalidatePath('/turno')
  return { ok: true as const }
}

/** Accion de formulario simple: no hay nada que decidir, o cierra o revienta. */
export async function cerrarTurno() {
  await requirePermission('turno:iniciar')
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('cerrar_turno')
  if (error) throw new Error(fallo(error).error)
  revalidatePath('/turno')
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
