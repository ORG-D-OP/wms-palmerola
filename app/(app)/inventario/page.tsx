import { requirePermission } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Icon } from '@/components/ui/icon'
import { CAMPO } from '@/components/ui/campos'
import { BotonCamara } from '@/components/ui/boton-camara'

export const metadata = { title: 'Inventario · WMS Palmerola' }

const LIMITE = 100

/**
 * «¿Dónde está el SKU X?» y «¿qué hay en la posición Y?» son las dos preguntas que más se
 * hacen en una bodega, y no había ninguna pantalla capaz de contestarlas. Una sola caja de
 * búsqueda: acepta SKU, código base, DUN-14, matrícula de pallet o código de posición.
 */
export default async function InventarioPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  await requirePermission('inventario:ver')
  const { q = '' } = await searchParams
  const supabase = await createSupabaseServerClient()

  const { data, error } = q.trim()
    ? await supabase.rpc('existencia_de', { p_texto: q.trim() }).limit(LIMITE)
    : { data: [], error: null }

  const filas = data ?? []
  const totalUnidades = filas.reduce((a, f) => a + Number(f.qty_base ?? 0), 0)

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 pb-8">
      <h1 className="text-xl">Inventario</h1>

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          autoFocus
          placeholder="SKU, DUN-14, pallet o posición"
          className={`${CAMPO} flex-1`}
        />
        <BotonCamara campo="q" />
        <button
          aria-label="Buscar"
          className="flex h-14 items-center rounded-xl bg-azul px-4 text-white"
        >
          <Icon name="search" />
        </button>
      </form>

      {!q.trim() ? (
        <p className="text-sm text-azul/60">
          Escanea o escribe cualquiera de los cuatro: el SKU, el DUN-14 de la caja, la
          matrícula del pallet o el código de la posición.
        </p>
      ) : error ? (
        <p className="text-sm text-azul/60">No se pudo consultar.</p>
      ) : filas.length === 0 ? (
        <p className="text-azul/60">Sin existencia para «{q.trim()}».</p>
      ) : (
        <>
          <p className="text-sm text-azul/60">
            {filas.length} {filas.length === 1 ? 'renglón' : 'renglones'} ·{' '}
            {totalUnidades.toLocaleString('es-HN')} unidades
          </p>

          <ul className="flex flex-col divide-y divide-borde">
            {filas.map((f) => (
              <li key={f.id} className="flex flex-col gap-1 py-3">
                <div className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{f.name}</span>
                    <span className="block text-sm text-azul/60">{f.sku}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-lg tabular-nums">{f.location_code}</span>
                    <span className="block text-xs text-azul/60">
                      {f.area_name ?? f.zone_code}
                    </span>
                  </span>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-azul/70">
                  <span className="tabular-nums">
                    {f.cajas} cajas
                    {Number(f.sueltas) > 0 ? ` y ${Number(f.sueltas)} sueltas` : ''}
                  </span>
                  {f.lot ? <span>lote {f.lot}</span> : null}
                  {f.expiry_date ? <span>vence {f.expiry_date}</span> : null}
                  {f.lpn_code ? <span className="font-mono text-xs">{f.lpn_code}</span> : null}
                  {Number(f.qty_allocated) > 0 ? (
                    <span className="tabular-nums">
                      {Number(f.qty_allocated).toLocaleString('es-HN')} apartadas
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          {filas.length === LIMITE ? (
            <p className="text-sm text-azul/60">
              Mostrando los primeros {LIMITE}. Afina la búsqueda.
            </p>
          ) : null}
        </>
      )}
    </main>
  )
}
