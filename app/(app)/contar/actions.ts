'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { toErrorResponse } from '@/lib/errors'

export type Linea = {
  posicion: string
  pallet: string | null
  sku: string
  nombre: string
  cajas: number
  sueltas: number
  porCaja: number
  lote: string | null
  vence: string | null
}

export type Resultado = {
  decia: number
  habia: number
  diferencia: number
  tareas: number
  deDonde: string | null
  falta: number
}

type Fail = { ok: false; error: string }

function fallo(error: { code?: string; message: string }): Fail {
  if (error.code === 'P0001' || error.code === '23514') return { ok: false, error: error.message }
  return { ok: false, error: toErrorResponse(error).body.error }
}

const Codigo = z.string().trim().min(3).max(32)

/** Lo que el sistema cree que hay ahí. Es lo que la persona va a desmentir o confirmar. */
export async function verLugar(codigo: string): Promise<{ ok: true; lineas: Linea[] } | Fail> {
  await requirePermission('conteo:ejecutar')

  const parsed = Codigo.safeParse(codigo)
  if (!parsed.success) return { ok: false, error: 'Escanea la posición o la matrícula del pallet.' }
  const texto = parsed.data.toUpperCase()

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('inventario')
    .select('location_code, lpn_code, sku, name, cajas, sueltas, por_caja, lot, expiry_date')
    .or(`location_code.eq.${texto},lpn_code.eq.${texto}`)
    .order('lpn_code')

  if (error) return fallo(error)

  const lineas = (data ?? []).map((l) => ({
    posicion: l.location_code ?? '',
    pallet: l.lpn_code,
    sku: l.sku ?? '',
    nombre: l.name ?? '',
    cajas: Number(l.cajas ?? 0),
    sueltas: Number(l.sueltas ?? 0),
    porCaja: Number(l.por_caja ?? 1),
    lote: l.lot,
    vence: l.expiry_date,
  }))

  if (lineas.length === 0) {
    return {
      ok: false,
      error: `El sistema no tiene nada en ${texto}. Si hay producto ahí, va por carga inicial.`,
    }
  }

  return { ok: true, lineas }
}

const Recuento = z.object({
  lugar: Codigo,
  cajas: z.coerce.number().min(0, 'Escribe cuántas cajas hay, aunque sean cero.'),
  pallet: Codigo.optional(),
  tarea: z.string().uuid().optional(),
})

export async function recontar(
  datos: z.input<typeof Recuento>,
): Promise<{ ok: true; resultado: Resultado } | Fail> {
  await requirePermission('conteo:ejecutar')

  const parsed = Recuento.safeParse(datos)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisa la cantidad.' }
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .rpc('recontar', {
      p_lugar: parsed.data.lugar,
      p_cajas: parsed.data.cajas,
      p_pallet: parsed.data.pallet ?? undefined,
      p_task_id: parsed.data.tarea ?? undefined,
    })
    .single()

  if (error) return fallo(error)
  if (!data) return { ok: false, error: 'No se pudo guardar el recuento.' }

  revalidatePath('/contar')

  return {
    ok: true,
    resultado: {
      decia: Number(data.decia ?? 0),
      habia: Number(data.habia ?? 0),
      diferencia: Number(data.diferencia ?? 0),
      tareas: Number(data.tareas ?? 0),
      deDonde: data.de_donde,
      falta: Number(data.falta ?? 0),
    },
  }
}

export async function cerrarConteo(tarea: string): Promise<{ ok: true } | Fail> {
  await requirePermission('conteo:ejecutar')

  const parsed = z.string().uuid().safeParse(tarea)
  if (!parsed.success) return { ok: false, error: 'Esa tarea no existe.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('cerrar_conteo', { p_task_id: parsed.data })

  if (error) return fallo(error)

  revalidatePath('/contar')
  return { ok: true }
}
