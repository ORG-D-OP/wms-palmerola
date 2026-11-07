import Link from 'next/link'
import { requireUser } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Icon } from '@/components/ui/icon'
import { CAMPO } from '@/components/ui/campos'
import { BotonCamara } from '@/components/ui/boton-camara'

export const metadata = { title: 'Productos · WMS Palmerola' }

const PAGINA = 50

const FILTROS = [
  { clave: '', etiqueta: 'Todos' },
  { clave: 'sin-codigo', etiqueta: 'Sin DUN-14' },
  { clave: 'compartido', etiqueta: 'Código compartido' },
  { clave: 'conflicto', etiqueta: 'En conflicto' },
] as const

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filtro?: string }>
}) {
  await requireUser()
  const { q = '', filtro = '' } = await searchParams
  const texto = q.trim()
  const supabase = await createSupabaseServerClient()

  let consulta = supabase
    .from('product_readiness')
    .select(
      'id, sku, name, dun, tipo_caja, por_caja, cajas_por_pallet, tiene_clase, tiene_corrugado, tiene_estiba, tiene_codigo, codigo_compartido, codigo_sin_conflicto',
    )
    .order('sku')
    .limit(PAGINA)

  // El DUN-14 es lo que está impreso en la caja, así que se busca por él igual que por SKU.
  if (texto) {
    const digitos = texto.replace(/\D/g, '')
    const condiciones = [`sku.ilike.%${texto}%`, `name.ilike.%${texto}%`]
    if (digitos.length >= 6) condiciones.push(`dun.like.%${digitos}%`)
    if (/^\d{5}$/.test(texto)) condiciones.push(`base_code.eq.${texto}`)
    consulta = consulta.or(condiciones.join(','))
  }

  if (filtro === 'sin-codigo') consulta = consulta.eq('tiene_codigo', false)
  if (filtro === 'compartido') consulta = consulta.eq('codigo_compartido', true)
  if (filtro === 'conflicto') consulta = consulta.eq('codigo_sin_conflicto', false)

  const { data } = await consulta
  const productos = data ?? []

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 pb-8">
      <h1 className="text-xl">Productos</h1>

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="SKU, nombre o DUN-14"
          className={`${CAMPO} flex-1`}
        />
        {filtro ? <input type="hidden" name="filtro" value={filtro} /> : null}
        <BotonCamara campo="q" />
        <button
          aria-label="Buscar"
          className="flex h-14 items-center rounded-xl bg-azul px-4 text-white"
        >
          <Icon name="search" />
        </button>
      </form>

      <nav className="-mx-4 flex gap-3 overflow-x-auto px-4 text-sm">
        {FILTROS.map((f) => (
          <Link
            key={f.clave}
            href={f.clave ? `/productos?filtro=${f.clave}` : '/productos'}
            className={`shrink-0 ${
              filtro === f.clave ? 'font-semibold' : 'underline underline-offset-4'
            }`}
          >
            {f.etiqueta}
          </Link>
        ))}
      </nav>

      <ul className="flex flex-col divide-y divide-borde">
        {productos.map((p) => (
          <li key={p.id}>
            <Link href={`/productos/${p.id}`} className="flex items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{p.name}</span>
                <span className="block text-sm text-azul/60">
                  {p.sku}
                  {p.por_caja ? ` · ${Number(p.por_caja)} por caja` : ''}
                  {p.cajas_por_pallet ? ` · ${p.cajas_por_pallet} cajas/pallet` : ''}
                </span>
                <span className="block font-mono text-xs text-azul/60">
                  {p.dun ?? 'sin DUN-14'}
                  {p.codigo_compartido ? ' · compartido' : ''}
                </span>
              </span>
              <span className="flex shrink-0 gap-1 text-xs">
                {(
                  [
                    ['clase', p.tiene_clase],
                    ['caja', p.tiene_corrugado],
                    ['estiba', p.tiene_estiba],
                    ['código', p.tiene_codigo],
                  ] as const
                ).map(([etiqueta, ok]) => (
                  <span
                    key={etiqueta}
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
        <p className="text-sm text-azul/60">Mostrando los primeros {PAGINA}. Afina la búsqueda.</p>
      ) : null}
    </main>
  )
}
