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

const Cambio = z.object({
  patron: z.string().trim().min(3).max(30),
  destino: z.string().trim().min(2).max(20),
})

/** Mueve un rango de posiciones de área: es como el jefe define el picking. */
export async function moverArea(_prev: unknown, datos: FormData) {
  await requirePermission('areas:administrar')

  const parsed = Cambio.safeParse({ patron: datos.get('patron'), destino: datos.get('area') })
  if (!parsed.success) return { ok: false as const, error: 'Revisa el rango y el área.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('reasignar_area_por_codigo', {
    p_patron: parsed.data.patron,
    p_area_code: parsed.data.destino,
  })

  if (error) return fallo(error)
  revalidatePath('/areas')
  revalidatePath('/')
  return { ok: true as const, movidas: data ?? 0 }
}

/** Declara para qué sirve un rango de posiciones: ramplas, corrugado, pallets vacíos. */
export async function cambiarUso(_prev: unknown, datos: FormData) {
  await requirePermission('areas:administrar')

  const parsed = Cambio.safeParse({ patron: datos.get('patron'), destino: datos.get('uso') })
  if (!parsed.success) return { ok: false as const, error: 'Revisa el rango y el uso.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('reasignar_uso_por_codigo', {
    p_patron: parsed.data.patron,
    p_usage_code: parsed.data.destino,
  })

  if (error) return fallo(error)
  revalidatePath('/areas')
  revalidatePath('/')
  return { ok: true as const, movidas: data ?? 0 }
}
