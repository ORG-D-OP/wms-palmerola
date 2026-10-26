'use server'

import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { toErrorResponse } from '@/lib/errors'

export type Job = {
  taskId: string
  lpnCode: string | null
  productName: string
  sku: string
  qty: number
  lot: string | null
  fromCode: string | null
  toCode: string | null
}

type Fail = { ok: false; error: string }

/** Los errores que lanzan las funciones son instrucciones para el operario; se muestran tal cual. */
function fallo(error: { code?: string; message: string }): Fail {
  if (error.code === 'P0001') return { ok: false, error: error.message }
  return { ok: false, error: toErrorResponse(error).body.error }
}

export async function claimPutaway(): Promise<{ ok: true; job: Job | null } | Fail> {
  await requirePermission('inventario:mover')
  const supabase = await createSupabaseServerClient()

  const { data: task, error } = await supabase.rpc('claim_next_task', { p_types: ['PUTAWAY'] })
  if (error) return fallo(error)
  if (!task?.id) return { ok: true, job: null }

  const { data } = await supabase
    .from('task')
    .select(
      `id, qty_base, lot,
       lpn(code),
       product(sku, name),
       from_location:location!task_from_location_id_fkey(code),
       to_location:location!task_to_location_id_fkey(code)`,
    )
    .eq('id', task.id)
    .single()

  if (!data) return { ok: false, error: 'No se pudo cargar la tarea.' }

  return {
    ok: true,
    job: {
      taskId: data.id,
      lpnCode: data.lpn?.code ?? null,
      productName: data.product?.name ?? '',
      sku: data.product?.sku ?? '',
      qty: Number(data.qty_base),
      lot: data.lot,
      fromCode: data.from_location?.code ?? null,
      toCode: data.to_location?.code ?? null,
    },
  }
}

const Scan = z.object({ taskId: z.uuid(), code: z.string().trim().min(3).max(48) })

export async function startPutaway(taskId: string, code: string) {
  await requirePermission('inventario:mover')
  const parsed = Scan.safeParse({ taskId, code })
  if (!parsed.success) return { ok: false as const, error: 'Codigo invalido.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('start_putaway', {
    p_task_id: parsed.data.taskId,
    p_lpn_code: parsed.data.code,
  })
  return error ? fallo(error) : { ok: true as const }
}

export async function completePutaway(taskId: string, code: string) {
  await requirePermission('inventario:mover')
  const parsed = Scan.safeParse({ taskId, code })
  if (!parsed.success) return { ok: false as const, error: 'Codigo invalido.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .rpc('complete_putaway', {
      p_task_id: parsed.data.taskId,
      p_location_code: parsed.data.code,
    })
    .single()

  if (error) return fallo(error)
  return { ok: true as const, locationCode: data?.location_code ?? parsed.data.code }
}
