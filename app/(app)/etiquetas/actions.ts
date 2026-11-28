'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { toErrorResponse } from '@/lib/errors'
import { desglose } from '@/lib/cajas'
import { etiquetaDePallet } from '@/lib/etiqueta/zpl'

type Fail = { ok: false; error: string }

function fallo(error: { code?: string; message: string }): Fail {
  if (error.code === 'P0001' || error.code === '23514') return { ok: false, error: error.message }
  return { ok: false, error: toErrorResponse(error).body.error }
}

/** Un trabajo de la cola, como lo enseña la lista. */
export type Trabajo = {
  id: number
  titulo: string
  estado: 'pendiente' | 'impresa' | 'fallida'
  error: string | null
  cuando: string
  /** Quien lo mandó a imprimir no se enseña: la cola es de la bodega, no de cada quien. */
  zpl: string
}

async function encolar(
  titulo: string,
  zpl: string,
  lpnId: string | null,
): Promise<{ ok: true; trabajo: Trabajo } | Fail> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('print_job')
    .insert({ titulo, zpl, lpn_id: lpnId })
    .select('id, titulo, status, error, created_at, zpl')
    .single()

  if (error) return fallo(error)

  revalidatePath('/etiquetas')
  return {
    ok: true,
    trabajo: {
      id: data.id,
      titulo: data.titulo,
      estado: data.status,
      error: data.error,
      cuando: data.created_at,
      zpl: data.zpl,
    },
  }
}

/**
 * Una etiqueta que no es de ningún pallet, para saber si la impresora contesta.
 *
 * Existe porque la primera pregunta de todas —¿llega el papel desde el teléfono?— no se puede
 * contestar recibiendo un camión de verdad. No toca inventario ni crea matrícula: no gasta un
 * número de `matricula_wms_seq` que después aparecería como un hueco.
 */
export async function imprimirPrueba(): Promise<{ ok: true; trabajo: Trabajo } | Fail> {
  await requirePermission('etiquetas:imprimir')

  const ahora = new Date()
  const zpl = etiquetaDePallet({
    matricula: 'WMS-PRUEBA',
    sku: '—',
    producto: 'Etiqueta de prueba del WMS',
    cajas: 0,
    lote: null,
    vence: null,
    origen: 'Prueba de impresora',
    cuando: ahora,
  })

  return encolar('Etiqueta de prueba', zpl, null)
}

const Matricula = z
  .string()
  .trim()
  .min(3, 'Escanea o escribe la matrícula del pallet.')
  .max(32)
  .transform((v) => v.toUpperCase())

/**
 * La etiqueta de un pallet que ya existe.
 *
 * Reimprimir no vuelve a calcular nada que la gente no pueda ver: si el pallet ya se movió o se
 * surtió en parte, la etiqueta nueva diría menos cajas que la pegada, y entonces hay dos
 * papeles distintos para el mismo bulto. Por eso la etiqueta se arma de lo que el pallet tiene
 * **hoy** y se guarda tal cual: la que se reimprime desde la cola es la misma, y ésta es nueva.
 */
export async function imprimirEtiquetaDePallet(
  matricula: string,
): Promise<{ ok: true; trabajo: Trabajo } | Fail> {
  await requirePermission('etiquetas:imprimir')

  const parsed = Matricula.safeParse(matricula)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Revisa.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('etiqueta_de_pallet')
    .select('lpn_id, matricula, sku, producto, lot, expiry_date, qty_base, por_caja')
    .eq('matricula', parsed.data)
    .maybeSingle()

  if (error) return fallo(error)
  if (!data) return { ok: false, error: `No hay ningún pallet con saldo con la matrícula ${parsed.data}.` }

  const { cajas } = desglose(Number(data.qty_base ?? 0), Number(data.por_caja ?? 1))

  const zpl = etiquetaDePallet({
    matricula: data.matricula ?? parsed.data,
    sku: data.sku ?? '—',
    producto: data.producto ?? '—',
    cajas,
    lote: data.lot,
    vence: data.expiry_date,
    origen: `Pallet ${data.matricula ?? parsed.data}`,
    cuando: new Date(),
  })

  return encolar(`${data.sku} · ${data.matricula}`, zpl, data.lpn_id)
}

/**
 * Cómo le fue al teléfono entregando el trabajo.
 *
 * Lo dice el teléfono porque es el único que habla con la impresora. «Entregada» quiere decir
 * que el navegador la mandó sin quejarse, no que el papel haya salido: la impresora no contesta
 * por esa vía. Quien de verdad lo confirma es quien la ve salir, y para eso está el reintento.
 */
export async function marcarEntrega(
  id: number,
  error: string | null,
): Promise<{ ok: true } | Fail> {
  await requirePermission('etiquetas:imprimir')

  const supabase = await createSupabaseServerClient()
  const { error: fail } = await supabase
    .from('print_job')
    .update(
      error
        ? { status: 'fallida' as const, error }
        : { status: 'impresa' as const, error: null, printed_at: new Date().toISOString() },
    )
    .eq('id', id)

  if (fail) return fallo(fail)

  revalidatePath('/etiquetas')
  return { ok: true }
}
