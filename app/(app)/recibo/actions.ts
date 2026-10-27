'use server'

import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { toErrorResponse } from '@/lib/errors'

export type Match = {
  productId: string
  sku: string
  name: string
  packagingLevelId: string
  packagingCode: string
  qtyBaseUnits: number
  requiresFefo: boolean
  casesPerPallet: number | null
}

export type ResolveResult =
  | { ok: true; matches: Match[] }
  | { ok: false; error: string }

const CodeSchema = z.string().trim().min(6).max(48)

export async function resolveBarcode(code: string): Promise<ResolveResult> {
  await requirePermission('inventario:mover')

  const parsed = CodeSchema.safeParse(code)
  if (!parsed.success) return { ok: false, error: 'Código inválido.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('barcode')
    .select(
      `packaging_level_id,
       packaging_level!inner(
         code, qty_base_units,
         product!inner(id, sku, name, requires_fefo, status, pallet_config(cases_per_pallet))
       )`,
    )
    .eq('code', parsed.data)
    .limit(10)

  if (error) return { ok: false, error: 'No se pudo consultar el código.' }

  const matches: Match[] = (data ?? [])
    .filter((row) => row.packaging_level.product.status === 'active')
    .map((row) => ({
      productId: row.packaging_level.product.id,
      sku: row.packaging_level.product.sku,
      name: row.packaging_level.product.name,
      packagingLevelId: row.packaging_level_id,
      packagingCode: row.packaging_level.code,
      qtyBaseUnits: Number(row.packaging_level.qty_base_units),
      requiresFefo: row.packaging_level.product.requires_fefo,
      casesPerPallet: row.packaging_level.product.pallet_config[0]?.cases_per_pallet ?? null,
    }))

  if (matches.length === 0) {
    return { ok: false, error: 'Ese código no corresponde a ningún producto activo.' }
  }

  return { ok: true, matches }
}

const LabelSchema = z.string().trim().min(4).max(32)

export async function checkPalletLabel(
  code: string,
): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  await requirePermission('inventario:mover')

  const parsed = LabelSchema.safeParse(code)
  if (!parsed.success) return { ok: false, error: 'Etiqueta inválida.' }

  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('lpn').select('code').eq('code', parsed.data).maybeSingle()

  if (data) return { ok: false, error: `El pallet ${parsed.data} ya está en el sistema.` }
  return { ok: true, code: parsed.data }
}

const ReceiveSchema = z.object({
  lpnCode: LabelSchema,
  productId: z.uuid(),
  packagingLevelId: z.uuid(),
  dockLocationId: z.uuid(),
  qty: z.coerce.number().positive().max(100000),
  lot: z.string().trim().max(40).optional(),
  expiry: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  idempotencyKey: z.string().trim().min(8).max(64),
})

export type ReceiveResult =
  | { ok: true; lpnCode: string; locationCode: string | null }
  | { ok: false; error: string }

export async function receivePallet(formData: FormData): Promise<ReceiveResult> {
  await requirePermission('inventario:mover')

  const parsed = ReceiveSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('receive_pallet', {
    p_lpn_code: parsed.data.lpnCode,
    p_product_id: parsed.data.productId,
    p_packaging_level_id: parsed.data.packagingLevelId,
    p_qty: parsed.data.qty,
    p_dock_location_id: parsed.data.dockLocationId,
    p_lot: parsed.data.lot || undefined,
    p_expiry: parsed.data.expiry || undefined,
    p_idempotency_key: parsed.data.idempotencyKey,
  })

  if (error) {
    // Los mensajes que lanza la funcion a proposito si son utiles al operario.
    if (error.code === 'P0001') return { ok: false, error: error.message }
    const { body } = toErrorResponse(error)
    return { ok: false, error: body.error }
  }

  const row = data?.[0]
  if (!row) return { ok: false, error: 'No se pudo registrar la recepción.' }

  return { ok: true, lpnCode: row.lpn_code, locationCode: row.to_location_code }
}
