'use server'

import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { toErrorResponse } from '@/lib/errors'

export type Linea = {
  lineNo: number
  sku: string
  name: string
  pedido: number
  surtido: number
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

export async function despachar(id: string): Promise<{ ok: true; camion: Camion } | Fail> {
  await requirePermission('despachos:administrar')

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('despachar', { p_order_id: id })
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
        .select('line_no, qty_base, product(sku, name), allocation(qty_base, task(status))')
        .eq('order_id', id)
        .order('line_no'),
    ])

  if (errorResumen) return fallo(errorResumen)
  if (errorLineas) return fallo(errorLineas)
  if (!resumen) return { ok: false, error: 'Ese camión ya no existe.' }

  const detalle: Linea[] = (lineas ?? []).map((l) => ({
    lineNo: l.line_no,
    sku: l.product?.sku ?? '',
    name: l.product?.name ?? '',
    pedido: Number(l.qty_base),
    surtido: (l.allocation ?? [])
      .filter((a) => a.task?.status === 'DONE')
      .reduce((suma, a) => suma + Number(a.qty_base), 0),
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
