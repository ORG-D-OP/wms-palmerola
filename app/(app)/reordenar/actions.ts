'use server'

import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { toErrorResponse } from '@/lib/errors'

export type Cosa = {
  posicion: string
  pallet: string | null
  sku: string
  nombre: string
  cajas: number
  sueltas: number
  apartada: number
  lote: string | null
  vence: string | null
}

export type Hecho = {
  pallet: string
  sku: string
  nombre: string
  /** En unidades base: la pantalla pinta las cajas que ya tenía a la vista. */
  unidades: number
  de: string
  a: string
}

type Fail = { ok: false; error: string }

function fallo(error: { code?: string; message: string }): Fail {
  if (error.code === 'P0001' || error.code === '23514') return { ok: false, error: error.message }
  return { ok: false, error: toErrorResponse(error).body.error }
}

const Codigo = z.string().trim().min(3).max(32)

/** Lo que hay en la posición o en el pallet que acaban de escanear. */
export async function verLugar(codigo: string): Promise<{ ok: true; cosas: Cosa[] } | Fail> {
  await requirePermission('inventario:mover')

  const parsed = Codigo.safeParse(codigo)
  if (!parsed.success) return { ok: false, error: 'Escanea la posición o la matrícula del pallet.' }
  const texto = parsed.data.toUpperCase()

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('inventario')
    .select('location_code, lpn_code, sku, name, cajas, sueltas, qty_allocated, lot, expiry_date')
    .or(`location_code.eq.${texto},lpn_code.eq.${texto}`)
    .order('lpn_code')

  if (error) return fallo(error)

  const cosas = (data ?? []).map((c) => ({
    posicion: c.location_code ?? '',
    pallet: c.lpn_code,
    sku: c.sku ?? '',
    nombre: c.name ?? '',
    cajas: Number(c.cajas ?? 0),
    sueltas: Number(c.sueltas ?? 0),
    apartada: Number(c.qty_allocated ?? 0),
    lote: c.lot,
    vence: c.expiry_date,
  }))

  if (cosas.length === 0) {
    return { ok: false, error: `En ${texto} no hay nada que mover.` }
  }

  return { ok: true, cosas }
}

const Movida = z.object({
  origen: Codigo,
  destino: Codigo,
  pallet: Codigo.optional(),
})

export async function mover(
  datos: z.input<typeof Movida>,
): Promise<{ ok: true; hecho: Hecho } | Fail> {
  await requirePermission('inventario:mover')

  const parsed = Movida.safeParse(datos)
  if (!parsed.success) return { ok: false, error: 'Escanea el lugar de donde sale y a dónde va.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .rpc('reordenar', {
      p_origen: parsed.data.origen,
      p_destino: parsed.data.destino,
      p_pallet: parsed.data.pallet ?? undefined,
    })
    .single()

  if (error) return fallo(error)
  if (!data) return { ok: false, error: 'No se pudo mover.' }

  return {
    ok: true,
    hecho: {
      pallet: data.pallet ?? '',
      sku: data.sku ?? '',
      nombre: data.nombre ?? '',
      unidades: Number(data.cantidad ?? 0),
      de: data.de ?? '',
      a: data.a ?? '',
    },
  }
}
