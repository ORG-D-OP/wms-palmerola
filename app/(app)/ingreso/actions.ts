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
  /** En true el documento lo abrió la bodega: no hay lista contra la que recibir. */
  sinAviso: boolean
  nota: string | null
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

/**
 * El pedido de SAP son dígitos. Los ingresos que la bodega abre al ver un camión sin aviso
 * llevan un código propio —`SA-261109-01`— que se ve distinto a propósito.
 */
const Pedido = z
  .string()
  .trim()
  .regex(/^(\d{4,20}|SA-\d{6}-\d{2})$/, 'Ese no es un pedido ni un código de ingreso.')

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

  const { data: cabecera } = await supabase
    .from('inbound_doc')
    .select('sin_aviso, nota')
    .eq('id', doc.id)
    .single()

  const { data: detalle } = await supabase
    .from('inbound_detail')
    .select('pallet_code, sku, name, qty_cases, lot, expiry_date, tipo_caja, received_at')
    .eq('doc_id', doc.id)
    .order('pallet_code')

  return {
    ok: true,
    doc: {
      pedido: doc.pedido,
      sinAviso: cabecera?.sin_aviso ?? false,
      nota: cabecera?.nota ?? null,
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

// ---------------------------------------------------------------------------------------
// El camión que nadie anunció
// ---------------------------------------------------------------------------------------

const Apertura = z.object({
  origen: z.string().trim().max(60).optional(),
  nota: z.string().trim().max(500).optional(),
})

export async function abrirSinAviso(
  datos: z.input<typeof Apertura>,
): Promise<{ ok: true; pedido: string } | Fail> {
  await requirePermission('ingresos:administrar')

  const parsed = Apertura.safeParse(datos)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('abrir_ingreso_sin_aviso', {
    p_origen: parsed.data.origen || undefined,
    p_nota: parsed.data.nota || undefined,
  })

  if (error) return fallo(error)
  if (!data?.pedido) return { ok: false, error: 'No se pudo abrir el ingreso.' }

  return { ok: true, pedido: data.pedido }
}

export type Producto = {
  sku: string
  name: string
  exigeVencimiento: boolean
}

/** Qué producto es el que el chequeador tiene en la mano, antes de preguntarle cuántas cajas. */
export async function buscarProducto(
  codigo: string,
): Promise<{ ok: true; producto: Producto } | Fail> {
  await requirePermission('inventario:mover')

  const parsed = z.string().trim().min(3).max(48).safeParse(codigo)
  if (!parsed.success) return { ok: false, error: 'Escanea la caja o escribe el SKU.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .rpc('producto_para_recibir', { p_codigo: parsed.data })
    .single()

  if (error) return fallo(error)
  if (!data?.sku) return { ok: false, error: 'No existe ese SKU ni ese código de barras.' }

  return {
    ok: true,
    producto: { sku: data.sku, name: data.name, exigeVencimiento: data.requires_fefo },
  }
}

const ReciboCiego = z.object({
  pedido: Pedido,
  codigo: z.string().trim().min(3).max(48),
  cases: z.coerce.number().positive().max(9999),
  dockLocationId: z.uuid(),
  lot: z.string().trim().max(40).optional(),
  expiry: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  palletCode: z.string().trim().min(4).max(32).optional(),
})

export async function recibirSinAviso(
  datos: z.input<typeof ReciboCiego>,
): Promise<{ ok: true; recibido: Recibido } | Fail> {
  await requirePermission('inventario:mover')

  const parsed = ReciboCiego.safeParse(datos)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .rpc('recibir_sin_aviso', {
      p_pedido: parsed.data.pedido,
      p_codigo: parsed.data.codigo,
      p_qty_cases: parsed.data.cases,
      p_dock_location_id: parsed.data.dockLocationId,
      p_lot: parsed.data.lot || undefined,
      p_expiry: parsed.data.expiry || undefined,
      p_pallet_code: parsed.data.palletCode || undefined,
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

export async function cerrarSinAviso(pedido: string): Promise<{ ok: true } | Fail> {
  await requirePermission('ingresos:administrar')

  const parsed = Pedido.safeParse(pedido)
  if (!parsed.success) return { ok: false, error: 'Código de ingreso inválido.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('cerrar_ingreso_sin_aviso', { p_pedido: parsed.data })
  if (error) return fallo(error)

  return { ok: true }
}

// ---------------------------------------------------------------------------------------
// El producto que no llega a guardarse
// ---------------------------------------------------------------------------------------

export type OpcionCrossdock = {
  orderId: string
  etiqueta: string
  anden: string
  faltanCajas: number
}

const Matricula = z.string().trim().min(4).max(32)

/**
 * A qué camión abierto le cabe entero este pallet. Si no hay ninguno, la opción no se le
 * muestra al operario: el crossdock es la excepción, no una pregunta de cada pallet.
 */
export async function opcionesCrossdock(
  lpnCode: string,
): Promise<{ ok: true; opciones: OpcionCrossdock[] } | Fail> {
  await requirePermission('inventario:mover')

  const parsed = Matricula.safeParse(lpnCode)
  if (!parsed.success) return { ok: true, opciones: [] }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('crossdock_posible', { p_lpn_code: parsed.data })
  if (error) return fallo(error)

  return {
    ok: true,
    opciones: (data ?? []).map((o) => ({
      orderId: o.order_id,
      etiqueta: o.etiqueta,
      anden: o.anden,
      faltanCajas: Number(o.faltan_cajas),
    })),
  }
}

const Paso = z.object({
  lpnCode: Matricula,
  orderId: z.uuid(),
  anden: z.string().trim().min(3).max(20),
})

export async function mandarACrossdock(
  datos: z.input<typeof Paso>,
): Promise<{ ok: true; anden: string; cajas: number; etiqueta: string } | Fail> {
  await requirePermission('inventario:mover')

  const parsed = Paso.safeParse(datos)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .rpc('crossdock', {
      p_lpn_code: parsed.data.lpnCode,
      p_order_id: parsed.data.orderId,
      p_anden: parsed.data.anden,
    })
    .single()

  if (error) return fallo(error)
  if (!data) return { ok: false, error: 'No se pudo mandar el pallet al andén.' }

  return { ok: true, anden: data.anden, cajas: Number(data.cajas), etiqueta: data.etiqueta }
}
