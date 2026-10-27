'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { toErrorResponse } from '@/lib/errors'

const Input = z.object({ productId: z.uuid(), code: z.string().trim().min(6).max(48) })

export async function assignBarcode(productId: string, code: string) {
  await requirePermission('maestros:editar')

  const parsed = Input.safeParse({ productId, code })
  if (!parsed.success) return { ok: false as const, error: 'Codigo invalido.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('assign_barcode', {
    p_product_id: parsed.data.productId,
    p_code: parsed.data.code,
  })

  if (error) {
    if (error.code === 'P0001') return { ok: false as const, error: error.message }
    return { ok: false as const, error: toErrorResponse(error).body.error }
  }

  revalidatePath(`/productos/${parsed.data.productId}`)
  return { ok: true as const, code: parsed.data.code }
}
