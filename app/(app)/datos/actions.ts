'use server'

import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { toErrorResponse } from '@/lib/errors'
import type { Json } from '@/lib/database.types'
import type { Reporte } from '@/lib/sap/reportes'

type Fail = { ok: false; error: string }

function fallo(error: { code?: string; message: string }): Fail {
  if (error.code === 'P0001') return { ok: false, error: error.message }
  return { ok: false, error: toErrorResponse(error).body.error }
}

const Kind = z.enum(['INGRESO', 'DESPACHO', 'INVENTARIO', 'PRONOSTICO', 'SALIDAS', 'TRAZA'])
const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

type Detalle = Record<string, number>

/**
 * Una tanda de filas ya entendidas. El Excel se abre en la máquina de quien lo sube —Vercel
 * no deja pasar un cuerpo de más de 4.5 MB y el de despacho pesa el doble—, así que aquí sólo
 * llegan filas, y de a poco.
 *
 * La trazabilidad de cajas no se guarda: hoy no ata con nada, así que se lee para contarla.
 */
export async function cargarTanda(
  kind: Reporte,
  filas: unknown[],
  fecha?: string,
  huellas: Record<string, string> = {},
): Promise<{ ok: true; detalle: Detalle } | Fail> {
  await requirePermission('datos:cargar')

  const esKind = Kind.safeParse(kind)
  if (!esKind.success) return { ok: false, error: 'Reporte desconocido.' }
  const tipo = esKind.data
  if (tipo === 'TRAZA') return { ok: true, detalle: {} }

  const p_filas = filas as Json
  const p_huellas = huellas as Json
  const supabase = await createSupabaseServerClient()

  const llamada = async () => {
    switch (tipo) {
      case 'INGRESO':
        return supabase.rpc('cargar_ingresos', { p_filas, p_huellas })
      case 'DESPACHO':
        return supabase.rpc('cargar_despachos', { p_filas, p_huellas })
      case 'PRONOSTICO':
        return supabase.rpc('cargar_pronostico', { p_filas })
      case 'SALIDAS':
        return supabase.rpc('cargar_salidas', { p_filas, p_huellas })
      case 'INVENTARIO': {
        const esFecha = Fecha.safeParse(fecha)
        if (!esFecha.success) throw new Error('La existencia necesita la fecha de la foto.')
        return supabase.rpc('cargar_inventario_sap', { p_filas, p_fecha: esFecha.data })
      }
    }
  }

  try {
    const { data, error } = await llamada()
    if (error) return fallo(error)
    return { ok: true, detalle: (data ?? {}) as Detalle }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo cargar.' }
  }
}

/**
 * Las huellas que la base ya tiene de esos documentos. Lo que coincida no hace falta volver a
 * mandarlo: el archivo lo trae igual que la vez pasada.
 *
 * Es una sola llamada y una sola fila de respuesta, aunque se pregunten cuatrocientos
 * documentos. Si algo falla, devuelve vacío y se manda todo: perder tiempo es mejor que
 * perder un complemento.
 */
export async function huellasConocidas(
  kind: Reporte,
  codigos: string[],
): Promise<Record<string, string>> {
  await requirePermission('datos:cargar')

  const esKind = Kind.safeParse(kind)
  if (!esKind.success) return {}

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('huellas_de', {
    p_kind: esKind.data,
    p_codigos: codigos,
  })
  if (error || !data) return {}
  return data as Record<string, string>
}

/** La zona del pronóstico es un parámetro del sitio: el archivo trae el país entero. */
export async function zonaDelPronostico(): Promise<string> {
  await requirePermission('datos:cargar')
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.rpc('zona_del_pronostico')
  return data ?? ''
}

export async function registrarCarga(
  kind: Reporte,
  archivo: string,
  leidas: number,
  detalle: Detalle,
): Promise<{ ok: true } | Fail> {
  await requirePermission('datos:cargar')

  const esKind = Kind.safeParse(kind)
  if (!esKind.success) return { ok: false, error: 'Reporte desconocido.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('registrar_carga', {
    p_kind: esKind.data,
    p_file_name: archivo.slice(0, 200),
    p_rows_read: leidas,
    p_detail: detalle,
  })
  if (error) return fallo(error)
  return { ok: true }
}
