'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { toErrorResponse } from '@/lib/errors'

type Fail = { ok: false; error: string }

/** P0001 y 23514 traen mensajes escritos para el supervisor: se pasan tal cual. */
function fallo(error: { code?: string; message: string }): Fail {
  if (error.code === 'P0001' || error.code === '23514') return { ok: false, error: error.message }
  return { ok: false, error: toErrorResponse(error).body.error }
}

const Pedido = z.object({
  code: z.string().trim().min(1).max(40),
  customer: z.string().trim().max(120).optional(),
  dockDoorId: z.uuid(),
})

export async function createOrder(_prev: unknown, datos: FormData) {
  await requirePermission('pedidos:administrar')
  const parsed = Pedido.safeParse({
    code: datos.get('code'),
    customer: datos.get('customer') || undefined,
    dockDoorId: datos.get('dockDoorId'),
  })
  if (!parsed.success) return { ok: false as const, error: 'Revisa los datos del pedido.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('sales_order')
    .insert({
      code: parsed.data.code,
      customer: parsed.data.customer ?? null,
      dock_door_id: parsed.data.dockDoorId,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return { ok: false as const, error: 'Ya existe un pedido con ese código.' }
    return fallo(error)
  }

  redirect(`/pedidos/${data.id}`)
}

const Linea = z.object({
  orderId: z.uuid(),
  sku: z.string().trim().min(1).max(40),
  qty: z.coerce.number().positive().max(100000),
})

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>

/**
 * El campo acepta el SKU tecleado y el DUN-14 escaneado: parado frente al producto, el
 * codigo que se tiene a mano es el de la caja, no el de SAP.
 *
 * Hay DUN-14 que comparten dos variantes del mismo producto. Ahi no se adivina: se pide el
 * SKU, porque meter la linea equivocada en un pedido se descubre en el camion.
 */
async function porSkuOCodigo(supabase: Supabase, texto: string) {
  const { data: porSku } = await supabase
    .from('product')
    .select('id, packaging_level(id, code)')
    .eq('sku', texto)
    .maybeSingle()
  if (porSku) return { producto: porSku }

  const { data: codigos } = await supabase
    .from('barcode')
    .select('packaging_level!inner(product!inner(id, status))')
    .eq('code', texto)
    .limit(10)

  const activos = [
    ...new Set(
      (codigos ?? [])
        .filter((c) => c.packaging_level.product.status === 'active')
        .map((c) => c.packaging_level.product.id),
    ),
  ]
  if (activos.length === 0) return { error: 'No existe ese SKU ni ese código de barras.' }
  if (activos.length > 1) {
    return { error: 'Ese código lo comparten varios productos. Escribe el SKU.' }
  }

  const { data: producto } = await supabase
    .from('product')
    .select('id, packaging_level(id, code)')
    .eq('id', activos[0]!)
    .maybeSingle()
  if (!producto) return { error: 'No existe ese SKU ni ese código de barras.' }
  return { producto }
}

export async function addLine(_prev: unknown, datos: FormData) {
  await requirePermission('pedidos:administrar')
  const parsed = Linea.safeParse({
    orderId: datos.get('orderId'),
    sku: datos.get('sku'),
    qty: datos.get('qty'),
  })
  if (!parsed.success) return { ok: false as const, error: 'Revisa el SKU y la cantidad.' }

  const supabase = await createSupabaseServerClient()
  const hallazgo = await porSkuOCodigo(supabase, parsed.data.sku)
  if ('error' in hallazgo) return { ok: false as const, error: hallazgo.error }
  const { producto } = hallazgo

  const { data: ultima } = await supabase
    .from('order_line')
    .select('line_no')
    .eq('order_id', parsed.data.orderId)
    .order('line_no', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await supabase.from('order_line').insert({
    order_id: parsed.data.orderId,
    line_no: (ultima?.line_no ?? 0) + 1,
    product_id: producto.id,
    packaging_level_id: producto.packaging_level.find((p) => p.code === 'CASE')?.id ?? null,
    qty_base: parsed.data.qty,
  })

  if (error) return fallo(error)
  revalidatePath(`/pedidos/${parsed.data.orderId}`)
  return { ok: true as const }
}

export async function removeLine(_prev: unknown, datos: FormData) {
  await requirePermission('pedidos:administrar')
  const id = z.uuid().safeParse(datos.get('lineId'))
  const orderId = z.uuid().safeParse(datos.get('orderId'))
  if (!id.success || !orderId.success) return { ok: false as const, error: 'Línea inválida.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('order_line').delete().eq('id', id.data)
  if (error) return fallo(error)

  revalidatePath(`/pedidos/${orderId.data}`)
  return { ok: true as const }
}

export async function releaseOrder(_prev: unknown, datos: FormData) {
  await requirePermission('pedidos:administrar')
  const orderId = z.uuid().safeParse(datos.get('orderId'))
  if (!orderId.success) return { ok: false as const, error: 'Pedido inválido.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('release_order', { p_order_id: orderId.data })
  if (error) return fallo(error)

  revalidatePath(`/pedidos/${orderId.data}`)
  return { ok: true as const, tareas: Number(data ?? 0) }
}
