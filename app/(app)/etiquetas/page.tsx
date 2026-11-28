import { requirePermission } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { publicEnv } from '@/lib/env'
import { EtiquetasForm } from './etiquetas-form'
import type { Trabajo } from './actions'

export const metadata = { title: 'Etiquetas de pallet · WMS Palmerola' }

/**
 * Imprimir la etiqueta de un pallet, y ver qué pasó con las que se mandaron.
 *
 * Está aparte del ingreso a propósito. Lo primero que hay que saber es si el papel sale desde
 * el teléfono, y eso no se puede averiguar en medio de la descarga de un camión: si falla,
 * habría un camión parado. Cuando se sepa que sale, la etiqueta se mete donde de verdad va,
 * que es al armar el pallet a granel.
 */
export default async function EtiquetasPage() {
  await requirePermission('etiquetas:imprimir')

  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('print_job')
    .select('id, titulo, status, error, created_at, zpl')
    .order('created_at', { ascending: false })
    .limit(20)

  const cola: Trabajo[] = (data ?? []).map((t) => ({
    id: t.id,
    titulo: t.titulo,
    estado: t.status,
    error: t.error,
    cuando: t.created_at,
    zpl: t.zpl,
  }))

  return (
    <main className="flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 pb-8 md:p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl">Etiquetas de pallet</h1>
        <p className="text-sm text-azul/60">
          La etiqueta la manda este teléfono a la impresora, porque el sistema vive fuera de la
          bodega y no la alcanza. Hay que estar en la red de la bodega para que salga.
        </p>
      </header>

      <EtiquetasForm cola={cola} impresora={publicEnv.NEXT_PUBLIC_IMPRESORA_ORIGEN} />
    </main>
  )
}
