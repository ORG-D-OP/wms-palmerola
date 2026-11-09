'use server'

import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { toErrorResponse } from '@/lib/errors'

export type Producto = { sku: string; name: string }

export type Sugerencia = { posicion: string; esPicking: boolean } | null

export type Cargado = {
  posicion: string
  sku: string
  name: string
  cases: number
  matricula: string
  aviso: string | null
}

export type Existente = {
  posicion: string
  lote: string | null
  vence: string | null
  cajas: number
  enPicking: boolean
}

type Fail = { ok: false; error: string }

function fallo(error: { code?: string; message: string }): Fail {
  if (error.code === 'P0001' || error.code === '23514') return { ok: false, error: error.message }
  return { ok: false, error: toErrorResponse(error).body.error }
}

const Codigo = z.string().trim().min(2).max(40)

/** Qué producto tengo en la mano, qué hay cargado de él y dónde debería ir este pallet. */
export async function identificar(
  codigo: string,
): Promise<
  { ok: true; producto: Producto; sugerencia: Sugerencia; cargado: Existente[] } | Fail
> {
  await requirePermission('inventario:mover')

  const parsed = Codigo.safeParse(codigo)
  if (!parsed.success) return { ok: false, error: 'Escanea una caja o escribe el SKU.' }

  const supabase = await createSupabaseServerClient()

  const { data: prod, error } = await supabase
    .rpc('producto_para_recibir', { p_codigo: parsed.data })
    .single()
  if (error) return fallo(error)
  if (!prod) return { ok: false, error: 'No se encontró ese producto.' }

  const [{ data: sug }, { data: cargado }] = await Promise.all([
    supabase.rpc('sugerir_posicion_inicial', { p_codigo: parsed.data }).maybeSingle(),
    supabase.rpc('carga_inicial_de', { p_codigo: parsed.data }),
  ])

  return {
    ok: true,
    producto: { sku: prod.sku, name: prod.name },
    sugerencia: sug?.code ? { posicion: sug.code, esPicking: sug.es_picking ?? false } : null,
    cargado: (cargado ?? []).map((c) => ({
      posicion: c.posicion,
      lote: c.lote,
      vence: c.vence,
      cajas: Number(c.cajas ?? 0),
      enPicking: c.en_picking ?? false,
    })),
  }
}

const Carga = z.object({
  codigo: Codigo,
  cases: z.coerce.number().positive('Escribe cuántas cajas hay.'),
  posicion: z.string().trim().min(2, 'Escanea la posición.').max(32),
  lot: z.string().trim().min(1, 'Escribe el lote.').max(40),
  expiry: z.string().date('Escribe el vencimiento.'),
  palletCode: z.string().trim().max(40).optional(),
})

export async function cargar(
  datos: z.input<typeof Carga>,
): Promise<{ ok: true; cargado: Cargado; cargadoDe: Existente[] } | Fail> {
  await requirePermission('inventario:mover')

  const parsed = Carga.safeParse(datos)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .rpc('cargar_inicial', {
      p_codigo: parsed.data.codigo,
      p_qty_cases: parsed.data.cases,
      p_posicion: parsed.data.posicion,
      p_lot: parsed.data.lot,
      p_expiry: parsed.data.expiry,
      p_pallet_code: parsed.data.palletCode?.trim() || undefined,
    })
    .single()

  if (error) return fallo(error)
  if (!data) return { ok: false, error: 'No se pudo cargar.' }

  const { data: cargadoDe } = await supabase.rpc('carga_inicial_de', {
    p_codigo: parsed.data.codigo,
  })

  return {
    ok: true,
    cargado: {
      posicion: data.posicion,
      sku: data.sku,
      name: data.product_name,
      cases: Number(data.cases ?? 0),
      matricula: data.matricula,
      aviso: data.aviso,
    },
    cargadoDe: (cargadoDe ?? []).map((c) => ({
      posicion: c.posicion,
      lote: c.lote,
      vence: c.vence,
      cajas: Number(c.cajas ?? 0),
      enPicking: c.en_picking ?? false,
    })),
  }
}
