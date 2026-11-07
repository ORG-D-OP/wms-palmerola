'use server'

import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { toErrorResponse } from '@/lib/errors'

export type Linea = {
  palletCode: string
  sku: string
  name: string
  cases: number
  lot: string | null
  expiry: string | null
  tipoCaja: string | null
  recibido: boolean
}

export type Documento = {
  pedido: string
  estado: string
  fecha: string | null
  pallets: number
  recibidos: number
  materiales: number
  cajas: number
  lineas: Linea[]
}

type Fail = { ok: false; error: string }

/** Los mensajes que lanzan las funciones estan escritos para el operario: van tal cual. */
function fallo(error: { code?: string; message: string }): Fail {
  if (error.code === 'P0001' || error.code === '23514') return { ok: false, error: error.message }
  return { ok: false, error: toErrorResponse(error).body.error }
}

const Pedido = z.string().trim().regex(/^\d{4,20}$/, 'El pedido son solo dígitos.')

export async function buscarIngreso(
  pedido: string,
): Promise<{ ok: true; doc: Documento } | Fail> {
  await requirePermission('inventario:mover')

  const parsed = Pedido.safeParse(pedido)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Pedido inválido.' }
  }

  const supabase = await createSupabaseServerClient()
  const { data: docs, error } = await supabase.rpc('buscar_ingreso', { p_pedido: parsed.data })
  if (error) return fallo(error)

  // Las vistas devuelven todo como anulable: Postgres no promete lo contrario.
  const doc = docs?.[0]
  if (!doc?.id || !doc.pedido) {
    return { ok: false, error: `No hay ningún ingreso con el pedido ${parsed.data}.` }
  }

  const { data: detalle } = await supabase
    .from('inbound_detail')
    .select('pallet_code, sku, name, qty_cases, lot, expiry_date, tipo_caja, received_at')
    .eq('doc_id', doc.id)
    .order('pallet_code')

  return {
    ok: true,
    doc: {
      pedido: doc.pedido,
      estado: doc.status ?? 'EXPECTED',
      fecha: doc.planned_at,
      pallets: doc.pallets ?? 0,
      recibidos: doc.recibidos ?? 0,
      materiales: doc.materiales ?? 0,
      cajas: Number(doc.cajas ?? 0),
      lineas: (detalle ?? []).map((l) => ({
        palletCode: l.pallet_code ?? '',
        sku: l.sku ?? '',
        name: l.name ?? '',
        cases: Number(l.qty_cases),
        lot: l.lot,
        expiry: l.expiry_date,
        tipoCaja: l.tipo_caja,
        recibido: l.received_at !== null,
      })),
    },
  }
}

const Recibo = z.object({
  pedido: Pedido,
  palletCode: z.string().trim().min(4).max(32),
  dockLocationId: z.uuid(),
  barcode: z.string().trim().max(48).optional(),
})

export type Recibido = {
  lpnCode: string
  locationCode: string | null
  sku: string
  name: string
  cases: number
  recibidos: number
  pallets: number
}

export async function recibirPallet(
  datos: z.input<typeof Recibo>,
): Promise<{ ok: true; recibido: Recibido } | Fail> {
  await requirePermission('inventario:mover')

  const parsed = Recibo.safeParse(datos)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .rpc('recibir_del_documento', {
      p_pedido: parsed.data.pedido,
      p_pallet_code: parsed.data.palletCode,
      p_dock_location_id: parsed.data.dockLocationId,
      p_barcode: parsed.data.barcode || undefined,
    })
    .single()

  if (error) return fallo(error)
  if (!data) return { ok: false, error: 'No se pudo registrar la recepción.' }

  return {
    ok: true,
    recibido: {
      lpnCode: data.lpn_code,
      locationCode: data.to_location_code,
      sku: data.sku,
      name: data.product_name,
      cases: Number(data.cases),
      recibidos: data.recibidos,
      pallets: data.pallets,
    },
  }
}
