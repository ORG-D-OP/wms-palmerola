'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { toErrorResponse } from '@/lib/errors'

function fallo(error: { code?: string; message: string }) {
  if (error.code === 'P0001' || error.code === '23514') return { ok: false as const, error: error.message }
  return { ok: false as const, error: toErrorResponse(error).body.error }
}

/**
 * El rango son los tres criterios que la pantalla acaba de contar, y viajan tal cual para que
 * lo que se cambie sea exactamente lo que se vio. Vacío significa «no filtra por eso»; la base
 * exige que al menos uno venga.
 */
const Cambio = z.object({
  patron: z.string().trim().max(30).optional(),
  zona: z.string().trim().max(20).optional(),
  nivel: z.coerce.number().int().min(0).max(20).optional(),
  destino: z.string().trim().min(2).max(20),
})

function criterios(datos: FormData) {
  return {
    patron: (datos.get('patron') as string) || undefined,
    zona: (datos.get('zona') as string) || undefined,
    nivel: (datos.get('nivel') as string) || undefined,
  }
}

/** Mueve un rango de posiciones de área: es como el jefe define el picking. */
export async function moverArea(_prev: unknown, datos: FormData) {
  await requirePermission('areas:administrar')

  const parsed = Cambio.safeParse({ ...criterios(datos), destino: datos.get('area') })
  if (!parsed.success) return { ok: false as const, error: 'Revisa el rango y el área.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('reasignar_area_donde', {
    p_area_code: parsed.data.destino,
    p_patron: parsed.data.patron,
    p_zona: parsed.data.zona,
    p_nivel: parsed.data.nivel,
  })

  if (error) return fallo(error)
  revalidatePath('/areas')
  revalidatePath('/')
  return { ok: true as const, movidas: data ?? 0 }
}

/** Declara para qué sirve un rango de posiciones: ramplas, corrugado, pallets vacíos. */
export async function cambiarUso(_prev: unknown, datos: FormData) {
  await requirePermission('areas:administrar')

  const parsed = Cambio.safeParse({ ...criterios(datos), destino: datos.get('uso') })
  if (!parsed.success) return { ok: false as const, error: 'Revisa el rango y el uso.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('reasignar_uso_donde', {
    p_usage_code: parsed.data.destino,
    p_patron: parsed.data.patron,
    p_zona: parsed.data.zona,
    p_nivel: parsed.data.nivel,
  })

  if (error) return fallo(error)
  revalidatePath('/areas')
  revalidatePath('/')
  return { ok: true as const, movidas: data ?? 0 }
}
