'use server'

import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { toErrorResponse } from '@/lib/errors'

export type Espacio = { code: string; uso: string; cantidad: number }

type Fail = { ok: false; error: string }

function fallo(error: { code?: string; message: string }): Fail {
  if (error.code === 'P0001' || error.code === '23514') return { ok: false, error: error.message }
  return { ok: false, error: toErrorResponse(error).body.error }
}

const Posicion = z.string().trim().min(2).max(32)

export async function buscarEspacio(
  codigo: string,
): Promise<{ ok: true; espacio: Espacio } | Fail> {
  await requirePermission('inventario:mover')

  const parsed = Posicion.safeParse(codigo)
  if (!parsed.success) return { ok: false, error: 'Escanea la etiqueta de la posición.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('retornables')
    .select('code, uso, cantidad')
    .eq('code', parsed.data)
    .maybeSingle()

  if (error) return fallo(error)
  if (!data?.code) {
    return {
      ok: false,
      error: `${parsed.data} no es un espacio de retornables. El jefe de bodega los marca desde Áreas.`,
    }
  }

  return {
    ok: true,
    espacio: { code: data.code, uso: data.uso ?? '', cantidad: Number(data.cantidad ?? 0) },
  }
}

const Conteo = z.object({
  posicion: Posicion,
  delta: z.coerce.number().int().refine((n) => n !== 0, 'Escribe cuántas.'),
})

export async function contarRetornable(
  datos: z.input<typeof Conteo>,
): Promise<{ ok: true; espacio: Espacio } | Fail> {
  await requirePermission('inventario:mover')

  const parsed = Conteo.safeParse(datos)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .rpc('contar_retornable', {
      p_posicion: parsed.data.posicion,
      p_delta: parsed.data.delta,
    })
    .single()

  if (error) return fallo(error)
  if (!data) return { ok: false, error: 'No se pudo guardar la cuenta.' }

  return {
    ok: true,
    espacio: { code: data.posicion, uso: data.uso, cantidad: data.quedan },
  }
}
