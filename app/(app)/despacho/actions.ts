'use server'

import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { toErrorResponse } from '@/lib/errors'
import { textoCajas } from '@/lib/cajas'

export type Linea = {
  id: string
  lineNo: number
  sku: string
  name: string
  porCaja: number
  /** Todo en unidades base: la pantalla las dice en cajas y sueltas. */
  pedido: number
  apartado: number
  surtido: number
  chequeada: boolean
  /** Lo que el chequeador dijo que subió de verdad. Nulo mientras no la haya chequeado. */
  arriba: number | null
}

export type Camion = {
  id: string
  code: string
  transporte: string | null
  entregas: string[]
  cliente: string | null
  estado: string
  anden: string | null
  lineas: number
  pedido: number
  surtido: number
  pendientes: number
  detalle: Linea[]
}

type Fail = { ok: false; error: string }

/** Los mensajes que lanzan las funciones estan escritos para el operario: van tal cual. */
function fallo(error: { code?: string; message: string }): Fail {
  if (error.code === 'P0001' || error.code === '23514') return { ok: false, error: error.message }
  return { ok: false, error: toErrorResponse(error).body.error }
}

const Codigo = z.string().trim().min(1).max(40)

/**
 * Un escaneo abre el camion, y abrirlo es repartir el trabajo.
 *
 * El codigo de barras de la hoja trae el numero de transporte. Si ese transporte viene en
 * varias hojas, aqui sale una sola vez con todo junto: la separacion en tabulados es del
 * cliente y a la bodega no le dice nada.
 *
 * Si el camión todavía no se había abierto, este escaneo arma las tareas de surtido. No hay
 * otro momento ni otra pantalla donde hacerlo: la hoja en la mano es lo que dice que ese
 * camión es trabajo de hoy.
 */
export async function buscarDespacho(codigo: string): Promise<{ ok: true; camion: Camion } | Fail> {
  await requirePermission('inventario:mover')

  const parsed = Codigo.safeParse(codigo)
  if (!parsed.success) return { ok: false, error: 'Código inválido.' }

  const supabase = await createSupabaseServerClient()
  const { data: id, error: errorBusqueda } = await supabase.rpc('buscar_despacho', {
    p_codigo: parsed.data,
  })
  if (errorBusqueda) return fallo(errorBusqueda)
  if (!id) return { ok: false, error: `No hay ningún camión con el código ${parsed.data}.` }

  const abierto = await cargar(supabase, id)
  if (!abierto.ok || abierto.camion.estado !== 'DRAFT') return abierto

  const { error } = await supabase.rpc('release_order', { p_order_id: id })
  if (error) return fallo(error)

  return cargar(supabase, id)
}

export async function recargarDespacho(id: string): Promise<{ ok: true; camion: Camion } | Fail> {
  await requirePermission('inventario:mover')
  const supabase = await createSupabaseServerClient()
  return cargar(supabase, id)
}

/**
 * Marcar en la hoja lo que subió al camión.
 *
 * Un escaneo marca la línea entera, y por eso el aviso dice **cuántas cajas** acaba de dar por
 * arriba: «Tostada: 25 cajas arriba». Antes decía sólo «Tostada marcado», así que el
 * chequeador confirmaba una cantidad que la pantalla no le ponía delante.
 */
export async function chequear(
  id: string,
  codigo: string,
): Promise<{ ok: true; camion: Camion; aviso: string } | Fail> {
  await requirePermission('inventario:mover')

  const parsed = Codigo.safeParse(codigo)
  if (!parsed.success) return { ok: false, error: 'Código inválido.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('verificar_linea', {
    p_order_id: id,
    p_codigo: parsed.data,
  })
  if (error) return fallo(error)

  const marcada = data?.[0]
  const recargado = await cargar(supabase, id)
  if (!recargado.ok) return recargado

  const linea = recargado.camion.detalle.find((l) => l.lineNo === marcada?.linea)

  return {
    ...recargado,
    aviso: marcada?.ya_estaba
      ? `${marcada.nombre} ya estaba marcado.`
      : linea
        ? `${marcada?.nombre ?? 'Línea'}: ${textoCajas(linea.surtido, linea.porCaja)} arriba.`
        : `${marcada?.nombre ?? 'Línea'} marcado.`,
  }
}

/**
 * Corregir la cantidad que subió: el chequeador cuenta y la hoja decía otra cosa.
 *
 * Se manda en cajas, que es como se cuenta un camión. Más de lo que bajó al andén la base no
 * lo acepta, y lo que no subió se queda en el andén cuando el camión sale.
 */
export async function corregirCantidad(
  orderId: string,
  lineaId: string,
  cajas: number,
): Promise<{ ok: true; camion: Camion } | Fail> {
  await requirePermission('despachos:administrar')

  if (!Number.isInteger(cajas) || cajas < 0) {
    return { ok: false, error: 'Escribe cuántas cajas subieron.' }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('corregir_chequeo', {
    p_order_line_id: lineaId,
    p_cajas: cajas,
  })
  if (error) return fallo(error)

  return cargar(supabase, orderId)
}

export async function despachar(
  id: string,
  nota?: string,
): Promise<{ ok: true; camion: Camion } | Fail> {
  await requirePermission('despachos:administrar')

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('despachar', {
    p_order_id: id,
    p_forzar: Boolean(nota),
    p_nota: nota ?? undefined,
  })
  if (error) return fallo(error)

  return cargar(supabase, id)
}

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>

async function cargar(supabase: Supabase, id: string): Promise<{ ok: true; camion: Camion } | Fail> {
  const [{ data: resumen, error: errorResumen }, { data: lineas, error: errorLineas }] =
    await Promise.all([
      supabase.from('despacho_progreso').select('*').eq('id', id).maybeSingle(),
      supabase
        .from('order_line')
        .select(
          'id, line_no, qty_base, checked_at, checked_qty_base, product(sku, name, packaging_level(code, qty_base_units)), allocation(qty_base, task(status))',
        )
        .eq('order_id', id)
        .order('line_no'),
    ])

  if (errorResumen) return fallo(errorResumen)
  if (errorLineas) return fallo(errorLineas)
  if (!resumen) return { ok: false, error: 'Ese camión ya no existe.' }

  const detalle: Linea[] = (lineas ?? []).map((l) => ({
    id: l.id,
    lineNo: l.line_no,
    sku: l.product?.sku ?? '',
    name: l.product?.name ?? '',
    porCaja:
      Number(
        (l.product?.packaging_level ?? []).find((n) => n.code === 'CASE')?.qty_base_units ?? 1,
      ) || 1,
    pedido: Number(l.qty_base),
    apartado: (l.allocation ?? []).reduce((suma, a) => suma + Number(a.qty_base), 0),
    surtido: (l.allocation ?? [])
      .filter((a) => a.task?.status === 'DONE')
      .reduce((suma, a) => suma + Number(a.qty_base), 0),
    chequeada: l.checked_at !== null,
    arriba: l.checked_qty_base === null ? null : Number(l.checked_qty_base),
  }))

  return {
    ok: true,
    camion: {
      id,
      code: resumen.code ?? '',
      transporte: resumen.transporte,
      entregas: resumen.entregas ?? [],
      cliente: resumen.customer,
      estado: resumen.status ?? '',
      anden: resumen.anden,
      lineas: resumen.lineas ?? 0,
      pedido: Number(resumen.pedido ?? 0),
      surtido: Number(resumen.surtido ?? 0),
      pendientes: resumen.pendientes ?? 0,
      detalle,
    },
  }
}
