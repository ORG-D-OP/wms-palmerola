import Link from 'next/link'
import { requireUser } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'

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
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">Productos</h1>

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="SKU o nombre"
          className="h-12 flex-1 rounded-lg border border-black/15 px-3 dark:border-white/20"
        />
        {incompletos ? <input type="hidden" name="incompletos" value="1" /> : null}
        <button className="h-12 rounded-lg border border-black/15 px-4 dark:border-white/20">
          Buscar
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

      <ul className="flex flex-col divide-y divide-black/10 dark:divide-white/15">
        {productos.map((p) => (
          <li key={p.id}>
            <Link href={`/productos/${p.id}`} className="flex items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.name}</span>
                <span className="block text-sm opacity-60">{p.sku}</span>
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
                    className={`rounded px-1.5 py-0.5 ${
                      ok
                        ? 'bg-green-600/15 text-green-700 dark:text-green-400'
                        : 'bg-black/8 opacity-50 dark:bg-white/10'
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

      {productos.length === 0 ? <p className="opacity-70">Sin resultados.</p> : null}
      {productos.length === PAGINA ? (
        <p className="text-sm opacity-60">Mostrando los primeros {PAGINA}. Afina la busqueda.</p>
      ) : null}
    </main>
  )
}
