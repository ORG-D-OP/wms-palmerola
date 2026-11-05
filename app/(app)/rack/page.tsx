import Link from 'next/link'
import { requirePermission } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { RackFace, type Celda } from '@/components/rack-face'

export const metadata = { title: 'Racks · WMS Palmerola' }

export default async function RackPage({
  searchParams,
}: {
  searchParams: Promise<{ carril?: string; destino?: string }>
}) {
  await requirePermission('inventario:ver')
  const { carril, destino } = await searchParams
  const supabase = await createSupabaseServerClient()

  const { data: todos } = await supabase
    .from('rack_elevacion')
    .select('lane_code, zone_code')
    .order('lane_code')

  const carriles = [...new Map((todos ?? []).map((r) => [r.lane_code, r.zone_code])).entries()]
    .filter(([code]) => code !== null)
    .map(([code, zona]) => ({ code: code as string, zona: zona as string }))

  const elegido = carril && carriles.some((c) => c.code === carril) ? carril : carriles[0]?.code

  const { data: filas } = elegido
    ? await supabase
        .from('rack_elevacion')
        .select(
          'code, bahia, nivel, fondo, sku, name, lot, expiry_date, lpn_code, apartada, usage_code, zone_code',
        )
        .eq('lane_code', elegido)
    : { data: [] }

  const celdas: Celda[] = (filas ?? []).map((f) => ({
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

  const cara = {
    zona: filas?.[0]?.zone_code ?? '',
    carril: elegido ?? '',
    niveles: Math.max(1, ...celdas.map((c) => c.nivel)),
    bahias: Math.max(1, ...celdas.map((c) => c.bahia)),
    fondos: Math.max(1, ...celdas.map((c) => c.fondo)),
    celdas,
  }

  const ocupadas = celdas.filter((c) => c.sku).length

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 pb-8">
      <div>
        <h1 className="text-xl">Cara del rack</h1>
        <p className="text-sm text-azul/60">
          El rack visto desde el pasillo. La vista de planta no muestra niveles.
        </p>
      </div>

      <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {carriles.map((c) => (
          <Link
            key={c.code}
            href={`/rack?carril=${encodeURIComponent(c.code)}`}
            aria-current={c.code === elegido ? 'page' : undefined}
            className={`flex h-10 shrink-0 items-center rounded-xl px-3 text-sm ${
              c.code === elegido ? 'bg-azul text-white' : 'border border-borde text-azul'
            }`}
          >
            {c.code}
          </Link>
        ))}
      </nav>

      {celdas.length > 0 ? (
        <>
          <p className="text-sm text-azul/60">
            {ocupadas} de {celdas.length} posiciones ocupadas · {cara.bahias} bahías ·{' '}
            {cara.niveles} niveles · doble profundidad
          </p>
          <RackFace cara={cara} destino={destino} />
        </>
      ) : (
        <p className="text-azul/60">Sin posiciones de rack.</p>
      )}
    </main>
  )
}
