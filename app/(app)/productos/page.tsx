import Link from 'next/link'
import { requireUser } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Icon } from '@/components/ui/icon'

export const metadata = { title: 'Productos · WMS Palmerola' }

const PAGINA = 50

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; incompletos?: string }>
}) {
  await requireUser()
  const { q = '', incompletos } = await searchParams
  const supabase = await createSupabaseServerClient()

  let consulta = supabase
    .from('product_readiness')
    .select('id, sku, name, tiene_clase, tiene_corrugado, tiene_estiba, tiene_codigo')
    .order('sku')
    .limit(PAGINA)

  if (q.trim()) consulta = consulta.or(`sku.ilike.%${q.trim()}%,name.ilike.%${q.trim()}%`)
  if (incompletos) consulta = consulta.eq('tiene_codigo', false)

  const { data } = await consulta
  const productos = data ?? []

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 pb-8">
      <h1 className="text-xl font-semibold">Productos</h1>

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="SKU o nombre"
          className="h-12 flex-1 rounded-xl border border-borde px-3 outline-none focus:border-celeste"
        />
        {incompletos ? <input type="hidden" name="incompletos" value="1" /> : null}
        <button aria-label="Buscar" className="flex h-12 items-center rounded-xl bg-azul px-4 text-white">
          <Icon name="search" />
        </button>
      </form>

      <nav className="flex gap-3 text-sm">
        <Link href="/productos" className={incompletos ? 'underline' : 'font-semibold'}>
          Todos
        </Link>
        <Link href="/productos?incompletos=1" className={incompletos ? 'font-semibold' : 'underline'}>
          Sin codigo
        </Link>
      </nav>

      <ul className="flex flex-col divide-y divide-borde">
        {productos.map((p) => (
          <li key={p.id}>
            <Link href={`/productos/${p.id}`} className="flex items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{p.name}</span>
                <span className="block text-sm text-azul/60">{p.sku}</span>
              </span>
              <span className="flex shrink-0 gap-1 text-xs">
                {[
                  ['clase', p.tiene_clase],
                  ['caja', p.tiene_corrugado],
                  ['estiba', p.tiene_estiba],
                  ['codigo', p.tiene_codigo],
                ].map(([etiqueta, ok]) => (
                  <span
                    key={String(etiqueta)}
                    className={`rounded-md px-1.5 py-0.5 ${
                      ok ? 'bg-[var(--verde)]/30 text-azul' : 'bg-azul-08 text-azul/40'
                    }`}
                  >
                    {etiqueta}
                  </span>
                ))}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {productos.length === 0 ? <p className="text-azul/60">Sin resultados.</p> : null}
      {productos.length === PAGINA ? (
        <p className="text-sm text-azul/60">Mostrando los primeros {PAGINA}. Afina la busqueda.</p>
      ) : null}
    </main>
  )
}
