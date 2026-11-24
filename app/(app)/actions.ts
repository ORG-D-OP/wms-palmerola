'use server'

import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { toErrorResponse } from '@/lib/errors'
import type { Cara } from '@/components/rack-face'
import { caraDe, caraDeCarril } from '@/lib/warehouse/cara'

const Codigo = z.string().trim().min(2).max(40)

/**
 * La cara de un rack, buscándolo.
 *
 * Sirve lo que la gente tenga a mano: el código de un carril entero (`R-ABA-L01`) o el de
 * una posición suelta, escaneada o escrita. Con una posición se dibuja la cara del carril al
 * que pertenece y se marca ahí, que es lo que uno quiere ver cuando pregunta por una
 * posición: no el cuadro solo, sino sus vecinos y qué queda libre a su lado.
 */
export async function buscarCara(
  codigo: string,
): Promise<{ ok: true; cara: Cara; marcada: string | null } | { ok: false; error: string }> {
  await requirePermission('inventario:ver')

  const parsed = Codigo.safeParse(codigo)
  if (!parsed.success) return { ok: false, error: 'Escribe el código de un rack o una posición.' }
  const texto = parsed.data.toUpperCase()

  const supabase = await createSupabaseServerClient()

  const porPosicion = await caraDe(supabase, texto)
  if (porPosicion) return { ok: true, cara: porPosicion, marcada: texto }

  const { data: carril, error } = await supabase
    .from('lane')
    .select('code')
    .ilike('code', texto)
    .limit(1)
    .maybeSingle()

  if (error) return { ok: false, error: toErrorResponse(error).body.error }

  const porCarril = await caraDeCarril(supabase, carril?.code ?? null)
  if (porCarril) return { ok: true, cara: porCarril, marcada: null }

  return {
    ok: false,
    error: `${texto} no es un rack ni una posición de rack. En piso no hay niveles que ver.`,
  }
}

/** Una fila de lo que hay debajo de un cuadro del mapa. Vacía si la posición está libre. */
export type Hueco = {
  location_code: string
  level: number | null
  area: string | null
  grupo: string | null
  dist_despacho_m: number | null
  usage_name: string | null
  sku: string | null
  nombre: string | null
  lpn_code: string | null
  lot: string | null
  expiry_date: string | null
  qty_base: number | null
  cajas: number | null
  qty_allocated: number | null
}

/**
 * Lo que hay bajo un cuadro del mapa.
 *
 * El mapa decía si un cuadro está ocupado y hasta ahí llegaba: para saber **qué** hay había
 * que irse al buscador con el código en la mano. Un toque lo contesta. En piso devuelve esa
 * posición; en rack, sus niveles, porque desde arriba son un solo cuadro.
 */
export async function queHayEn(
  cuadro: string,
): Promise<{ ok: true; huecos: Hueco[] } | { ok: false; error: string }> {
  await requirePermission('inventario:ver')

  const parsed = Codigo.safeParse(cuadro)
  if (!parsed.success) return { ok: false, error: 'Ese cuadro no tiene un código válido.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('que_hay_en', {
    p_cuadro: parsed.data.toUpperCase(),
  })

  if (error) return { ok: false, error: toErrorResponse(error).body.error }
  return { ok: true, huecos: (data ?? []) as Hueco[] }
}
