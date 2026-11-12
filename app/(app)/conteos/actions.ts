'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { toErrorResponse } from '@/lib/errors'

export type Lanzado = { tareas: number; personas: number; repartidas: number }

type Fail = { ok: false; error: string }

function fallo(error: { code?: string; message: string }): Fail {
  if (error.code === 'P0001' || error.code === '23514') return { ok: false, error: error.message }
  return { ok: false, error: toErrorResponse(error).body.error }
}

const Conteo = z.object({
  zona: z.string().trim().max(40).optional(),
  area: z.string().trim().max(40).optional(),
  nivel: z.coerce.number().int().min(0).max(20).optional(),
})

export async function lanzarConteo(
  _previo: { ok: true; lanzado: Lanzado } | Fail | null,
  datos: FormData,
): Promise<{ ok: true; lanzado: Lanzado } | Fail> {
  await requirePermission('conteo:lanzar')

  const parsed = Conteo.safeParse({
    zona: datos.get('zona') || undefined,
    area: datos.get('area') || undefined,
    nivel: datos.get('nivel') || undefined,
  })
  if (!parsed.success) return { ok: false, error: 'Revisa la zona, el área y el nivel.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .rpc('lanzar_conteo', {
      p_zona: parsed.data.zona ?? undefined,
      p_area: parsed.data.area ?? undefined,
      p_nivel: parsed.data.nivel ?? undefined,
    })
    .single()

  if (error) return fallo(error)
  if (!data) return { ok: false, error: 'No se pudo lanzar el conteo.' }

  revalidatePath('/conteos')

  return {
    ok: true,
    lanzado: {
      tareas: Number(data.tareas ?? 0),
      personas: Number(data.personas ?? 0),
      repartidas: Number(data.repartidas ?? 0),
    },
  }
}
