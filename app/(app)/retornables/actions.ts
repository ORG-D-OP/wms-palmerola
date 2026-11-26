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

/**
 * La cantidad siempre positiva, y la dirección sólo del botón.
 *
 * Antes se recibía un `delta` con signo y la pantalla lo armaba multiplicando por ±1. Medido a
 * clic: escribir «-5» en «Guardar aquí» quitaba 5, y escribir «-500» en «Quitar de aquí»
 * sumaba 500. Un menos de más en el teclado del teléfono invertía la operación en silencio.
 */
const Conteo = z.object({
  posicion: Posicion,
  cuantas: z.coerce
    .number({ message: 'Escribe cuántas.' })
    .int('Las cuentas van de una en una: escribe un número entero.')
    .positive('Escribe cuántas, de 1 en adelante. Para quitar, usa «Quitar de aquí».'),
  signo: z.union([z.literal(1), z.literal(-1)]),
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
      p_delta: parsed.data.signo * parsed.data.cuantas,
    })
    .single()

  if (error) return fallo(error)
  if (!data) return { ok: false, error: 'No se pudo guardar la cuenta.' }

  return {
    ok: true,
    espacio: { code: data.posicion, uso: data.uso, cantidad: data.quedan },
  }
}
