import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePermission } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ESTADO } from '../estado'
import { OrderLines } from './order-lines'

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('pedidos:administrar')
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const { data: pedido } = await supabase
    .from('sales_order')
    .select(
      `id, code, customer, status, created_at, released_at, dock_door(code),
       order_line(id, line_no, qty_base, product(sku, name))`,
    )
    .eq('id', id)
    .single()

  if (!pedido) notFound()

  const { data: apartados } = await supabase
    .from('allocation')
    .select(
      `qty_base,
       task:task(id, status, qty_base, from_location:location!task_from_location_id_fkey(code)),
       order_line!inner(order_id)`,
    )
    .eq('order_line.order_id', id)

  const tareas = (apartados ?? []).flatMap((a) => (a.task ? [a.task] : []))

  const lineas = [...pedido.order_line].sort((a, b) => a.line_no - b.line_no)

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-8">
      <div>
        <Link href="/pedidos" className="text-sm underline underline-offset-4">
          Pedidos
        </Link>
        <h1 className="mt-2 text-xl">{pedido.code}</h1>
        <p className="text-sm text-azul/60">
          {pedido.customer ?? 'sin cliente'} · {pedido.dock_door?.code ?? 'sin andén'} ·{' '}
          {ESTADO[pedido.status]}
        </p>
      </div>

      <OrderLines
        orderId={pedido.id}
        editable={pedido.status === 'DRAFT'}
        lineas={lineas.map((l) => ({
          id: l.id,
          lineNo: l.line_no,
          sku: l.product?.sku ?? '',
          name: l.product?.name ?? '',
          qty: Number(l.qty_base),
        }))}
      />

      {tareas.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg">Tareas de surtido</h2>
          <ul className="flex flex-col divide-y divide-borde text-sm">
            {tareas.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2">
                <span className="tabular-nums">{t.from_location?.code}</span>
                <span className="text-azul/60">
                  {Number(t.qty_base)} cajas · {t.status === 'DONE' ? 'surtida' : 'pendiente'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  )
}
