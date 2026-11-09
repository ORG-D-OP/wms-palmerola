import 'server-only'
import type { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Cara, Celda } from '@/components/rack-face'

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>

/** La cara de un carril entero, con lo que hay en cada nivel y lo que está vacío. */
export async function caraDeCarril(
  supabase: Supabase,
  laneCode: string | null,
): Promise<Cara | null> {
  if (!laneCode) return null

  const { data: filas } = await supabase
    .from('rack_elevacion')
    .select(
      'code, bahia, nivel, fondo, sku, name, lot, expiry_date, lpn_code, apartada, usage_code, zone_code',
    )
    .eq('lane_code', laneCode)

  if (!filas?.length) return null

  const celdas: Celda[] = filas.map((f) => ({
    code: f.code ?? '',
    bahia: f.bahia ?? 0,
    nivel: f.nivel ?? 0,
    fondo: f.fondo ?? 1,
    sku: f.sku,
    name: f.name,
    lot: f.lot,
    expiry: f.expiry_date,
    lpn: f.lpn_code,
    apartada: f.apartada ?? false,
    uso: f.usage_code ?? 'PRODUCTO',
  }))

  return {
    zona: filas[0]?.zone_code ?? '',
    carril: laneCode,
    niveles: Math.max(1, ...celdas.map((c) => c.nivel)),
    bahias: Math.max(1, ...celdas.map((c) => c.bahia)),
    fondos: Math.max(1, ...celdas.map((c) => c.fondo)),
    celdas,
  }
}

/**
 * La cara del carril al que pertenece una posición, o nada si esa posición no está en rack.
 *
 * Se trae junto con la tarea, no cuando la persona toca el plano: a esa altura ya está
 * subida en el equipo con el pallet en las uñas, y una espera ahí es una espera de verdad.
 */
export async function caraDe(supabase: Supabase, code: string | null): Promise<Cara | null> {
  if (!code) return null

  const { data: cual } = await supabase
    .from('rack_elevacion')
    .select('lane_code')
    .eq('code', code)
    .maybeSingle()

  return caraDeCarril(supabase, cual?.lane_code ?? null)
}
