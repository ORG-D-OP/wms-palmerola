'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { toErrorResponse } from '@/lib/errors'

const Umbral = z.object({
  area: z.string().trim().min(1).max(32),
  pct: z.coerce.number().int().min(1, 'El aviso va de 1 a 100.').max(100, 'El aviso va de 1 a 100.'),
})

export async function ajustarAviso(_: unknown, datos: FormData) {
  await requirePermission('reabastecimiento:lanzar')

  const parsed = Umbral.safeParse({ area: datos.get('area'), pct: datos.get('pct') })
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('ajustar_aviso_reabastecimiento', {
    p_area_code: parsed.data.area,
    p_pct: parsed.data.pct,
  })

  if (error) {
    if (error.code === 'P0001') return { ok: false as const, error: error.message }
    return { ok: false as const, error: toErrorResponse(error).body.error }
  }

  revalidatePath('/reabastecer')
  return { ok: true as const, pct: parsed.data.pct }
}
