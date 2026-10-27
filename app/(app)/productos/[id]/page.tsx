import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth/session'
import { can } from '@/lib/auth/roles'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { AssignBarcode } from './assign-barcode'

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser()
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const { data: producto } = await supabase
    .from('product')
    .select(
      `id, sku, name, base_uom, requires_fefo, shelf_life_days, external_barcode_hint,
       packaging_level(code, qty_base_units, length_mm, width_mm, height_mm, gross_weight_g,
                       barcode(code, is_primary, verified_at)),
       pallet_config(cases_per_pallet, pallet_type_code)`,
    )
    .eq('id', id)
    .single()

  if (!producto) notFound()

  const caja = producto.packaging_level.find((p) => p.code === 'CASE')
  const codigos = producto.packaging_level.flatMap((p) => p.barcode)

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-8">
      <div>
        <Link href="/productos" className="text-sm underline underline-offset-4">
          Productos
        </Link>
        <h1 className="mt-2 text-xl">{producto.name}</h1>
        <p className="text-sm text-azul/60">{producto.sku}</p>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        {[
          ['Unidad base', producto.base_uom],
          ['Unidades por caja', caja ? String(caja.qty_base_units) : 'sin dato'],
          [
            'Medidas de caja',
            caja?.length_mm ? `${caja.length_mm} x ${caja.width_mm} x ${caja.height_mm} mm` : 'sin dato',
          ],
          ['Peso de caja', caja?.gross_weight_g ? `${(caja.gross_weight_g / 1000).toFixed(2)} kg` : 'sin dato'],
          ['Cajas por pallet', producto.pallet_config[0]?.cases_per_pallet ?? 'sin dato'],
          ['Vida de anaquel', producto.shelf_life_days ? `${producto.shelf_life_days} dias` : 'sin dato'],
          ['Vencimiento', producto.requires_fefo ? 'obligatorio' : 'no exigido'],
        ].map(([k, v]) => (
          <div key={String(k)} className="rounded-xl border border-borde p-3">
            <dt className="text-xs text-azul/60">{k}</dt>
            <dd className="">{v}</dd>
          </div>
        ))}
      </dl>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg">Codigos de barras</h2>
        {codigos.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {codigos.map((c) => (
              <li key={c.code} className="flex items-center gap-2">
                <span className="font-mono">{c.code}</span>
                {c.verified_at ? (
                  <span className="rounded-md bg-[var(--verde)]/30 px-1.5 py-0.5 text-xs">verificado</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-azul/60">Sin codigo asignado. No se puede almacenar todavia.</p>
        )}

        {can(user.role, 'maestros:editar') && caja ? (
          <AssignBarcode productId={producto.id} hint={producto.external_barcode_hint} />
        ) : null}
      </section>
    </main>
  )
}
