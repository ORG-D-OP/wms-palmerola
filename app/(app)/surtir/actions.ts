'use server'

import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { toErrorResponse } from '@/lib/errors'
import type { Cara } from '@/components/rack-face'
import { caraDe } from '@/lib/warehouse/cara'

export type Pick = {
  taskId: string
  productName: string
  sku: string
  /** En unidades base: lo que la tarea pide. La pantalla lo dice en cajas y sueltas. */
  qty: number
  porCaja: number
  lot: string | null
  expiry: string | null
  fromCode: string | null
  toCode: string | null
  /** La matrícula del pallet, cuando la tarea es de un pallet concreto. */
  lpnCode: string | null
  /** El pallet se va completo: no hay nada que contar ni caja que abrir. */
  palletEntero: boolean
  cara: Cara | null
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
      `id, qty_base, lot, expiry_date, lpn_id,
       lpn(code),
       product(sku, name, packaging_level(code, qty_base_units)),
       from_location:location!task_from_location_id_fkey(code),
       to_location:location!task_to_location_id_fkey(code)`,
    )
    .eq('id', task.id)
    .single()

  if (!data) return { ok: false, error: 'No se pudo cargar la tarea.' }

  const fromCode = data.from_location?.code ?? null
  const qty = Number(data.qty_base)
  const porCaja =
    Number(
      (data.product?.packaging_level ?? []).find((n) => n.code === 'CASE')?.qty_base_units ?? 1,
    ) || 1

  // Un pallet se va entero cuando la tarea pide todo lo que ese pallet tiene en esa
  // posición. Eso cambia la pantalla: se confirma con la matrícula y no se cuenta nada.
  let palletEntero = false
  if (data.lpn_id && task.from_location_id) {
    const { data: hay } = await supabase
      .from('stock')
      .select('qty_base')
      .eq('location_id', task.from_location_id)
      .eq('product_id', task.product_id ?? '')
      .eq('lpn_id', data.lpn_id)
      .maybeSingle()
    palletEntero = hay ? Number(hay.qty_base) === qty : false
  }

  return {
    ok: true,
    pick: {
      taskId: data.id,
      productName: data.product?.name ?? '',
      sku: data.product?.sku ?? '',
      qty,
      porCaja,
      lot: data.lot,
      expiry: data.expiry_date,
      fromCode,
      toCode: data.to_location?.code ?? null,
      lpnCode: data.lpn?.code ?? null,
      palletEntero,
      cara: await caraDe(supabase, fromCode),
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

const Confirm = Scan.extend({
  cajas: z.coerce.number().min(0).max(100000),
  sueltas: z.coerce.number().min(0).max(100000),
})

export async function completePick(taskId: string, code: string, cajas: number, sueltas: number) {
  await requirePermission('surtido:ejecutar')
  const parsed = Confirm.safeParse({ taskId, code, cajas, sueltas })
  if (!parsed.success) return { ok: false as const, error: 'Revisa los datos.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .rpc('complete_pick', {
      p_task_id: parsed.data.taskId,
      p_barcode: parsed.data.code,
      p_cajas: parsed.data.cajas,
      p_sueltas: parsed.data.sueltas,
    })
    .single()

  if (error) return fallo(error)
  return { ok: true as const, texto: data?.texto ?? '' }
}
