'use server'

import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { toErrorResponse } from '@/lib/errors'

export type Pick = {
  taskId: string
  productName: string
  sku: string
  qty: number
  lot: string | null
  expiry: string | null
  fromCode: string | null
  toCode: string | null
}

type Fail = { ok: false; error: string }

function fallo(error: { code?: string; message: string }): Fail {
  if (error.code === 'P0001' || error.code === '23514') return { ok: false, error: error.message }
  return { ok: false, error: toErrorResponse(error).body.error }
}

export async function claimPick(): Promise<{ ok: true; pick: Pick | null } | Fail> {
  await requirePermission('surtido:ejecutar')
  const supabase = await createSupabaseServerClient()

  const { data: task, error } = await supabase.rpc('claim_next_task', { p_types: ['PICK'] })
  if (error) return fallo(error)
  if (!task?.id) return { ok: true, pick: null }

  const { data } = await supabase
    .from('task')
    .select(
      `id, qty_base, lot, expiry_date,
       product(sku, name),
       from_location:location!task_from_location_id_fkey(code),
       to_location:location!task_to_location_id_fkey(code)`,
    )
    .eq('id', task.id)
    .single()

  if (!data) return { ok: false, error: 'No se pudo cargar la tarea.' }

  return {
    ok: true,
    pick: {
      taskId: data.id,
      productName: data.product?.name ?? '',
      sku: data.product?.sku ?? '',
      qty: Number(data.qty_base),
      lot: data.lot,
      expiry: data.expiry_date,
      fromCode: data.from_location?.code ?? null,
      toCode: data.to_location?.code ?? null,
    },
  }
}

const Scan = z.object({ taskId: z.uuid(), code: z.string().trim().min(3).max(48) })

export async function startPick(taskId: string, code: string) {
  await requirePermission('surtido:ejecutar')
  const parsed = Scan.safeParse({ taskId, code })
  if (!parsed.success) return { ok: false as const, error: 'Código inválido.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('start_pick', {
    p_task_id: parsed.data.taskId,
    p_location_code: parsed.data.code,
  })
  return error ? fallo(error) : { ok: true as const }
}

const Confirm = Scan.extend({ qty: z.coerce.number().positive().max(100000) })

export async function completePick(taskId: string, code: string, qty: number) {
  await requirePermission('surtido:ejecutar')
  const parsed = Confirm.safeParse({ taskId, code, qty })
  if (!parsed.success) return { ok: false as const, error: 'Revisa los datos.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .rpc('complete_pick', {
      p_task_id: parsed.data.taskId,
      p_barcode: parsed.data.code,
      p_qty: parsed.data.qty,
    })
    .single()

  if (error) return fallo(error)
  return { ok: true as const, surtido: Number(data?.surtido ?? parsed.data.qty) }
}
