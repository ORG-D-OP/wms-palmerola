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
