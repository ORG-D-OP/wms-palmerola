'use client'

import { useActionState } from 'react'
import { Aviso, Logro } from '@/components/ui/feedback'
import { BOTON, BOTON_SUAVE, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { Icon } from '@/components/ui/icon'
import { addLine, releaseOrder, removeLine } from '../actions'

type Linea = { id: string; lineNo: number; sku: string; name: string; qty: number }

export function OrderLines({
  orderId,
  editable,
  lineas,
}: {
  orderId: string
  editable: boolean
  lineas: Linea[]
}) {
  const [agregado, agregar, agregando] = useActionState(addLine, null)
  const [quitado, quitar] = useActionState(removeLine, null)
  const [liberado, liberar, liberando] = useActionState(releaseOrder, null)

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg">Líneas</h2>

      {lineas.length > 0 ? (
        <ul className="flex flex-col divide-y divide-borde">
          {lineas.map((l) => (
            <li key={l.id} className="flex items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{l.name}</span>
                <span className="block text-sm text-azul/60">
                  {l.sku} · {l.qty} cajas
                </span>
              </span>
              {editable ? (
                <form action={quitar}>
                  <input type="hidden" name="orderId" value={orderId} />
                  <input type="hidden" name="lineId" value={l.id} />
                  <button aria-label={`Quitar la línea ${l.lineNo}`} className="p-2 text-azul/60">
                    <Icon name="close" />
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-azul/60">Sin líneas todavía.</p>
      )}

      {editable ? (
        <>
          <form action={agregar} className="flex flex-col gap-3 rounded-2xl border border-borde p-4">
            <div className="flex gap-3">
              <label className="flex flex-[2] flex-col gap-1.5">
                <span className={ETIQUETA}>SKU</span>
                <input name="sku" required maxLength={40} className={CAMPO} />
              </label>
              <label className="flex flex-1 flex-col gap-1.5">
                <span className={ETIQUETA}>Cajas</span>
                <input name="qty" type="number" inputMode="numeric" min={1} required className={CAMPO} />
              </label>
            </div>
            <input type="hidden" name="orderId" value={orderId} />
            <button type="submit" disabled={agregando} className={BOTON_SUAVE}>
              {agregando ? 'Agregando...' : 'Agregar línea'}
            </button>
          </form>

          {lineas.length > 0 ? (
            <form action={liberar}>
              <input type="hidden" name="orderId" value={orderId} />
              <button type="submit" disabled={liberando} className={BOTON}>
                {liberando ? 'Liberando...' : 'Liberar a surtido'}
              </button>
            </form>
          ) : null}
        </>
      ) : null}

      {agregado && !agregado.ok ? <Aviso>{agregado.error}</Aviso> : null}
      {quitado && !quitado.ok ? <Aviso>{quitado.error}</Aviso> : null}
      {liberado && !liberado.ok ? <Aviso>{liberado.error}</Aviso> : null}
      {liberado?.ok ? <Logro>Se crearon {liberado.tareas} tareas de surtido.</Logro> : null}
    </section>
  )
}
