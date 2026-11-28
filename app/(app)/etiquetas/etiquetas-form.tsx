'use client'

import { useState, useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'
import { Aviso, Logro } from '@/components/ui/feedback'
import { BOTON, BOTON_SUAVE } from '@/components/ui/campos'
import { entregarALaImpresora } from '@/lib/etiqueta/entregar'
import { fechaYHora } from '@/lib/warehouse/hora'
import { imprimirEtiquetaDePallet, imprimirPrueba, marcarEntrega, type Trabajo } from './actions'

const ESTADO = {
  pendiente: 'Sin entregar',
  impresa: 'Entregada',
  fallida: 'Falló',
} as const

/**
 * Imprimir es dos pasos, y se ven como uno.
 *
 * El servidor arma la etiqueta y la guarda en la cola; el teléfono es quien se la lleva a la
 * impresora, porque es el único de los dos que la alcanza. Separarlos es lo que permite
 * reintentar: si el papel no sale —el rollo se acabó, el teléfono se salió de la red—, la
 * etiqueta no se pierde ni hay que volver a armarla, se vuelve a entregar la misma.
 */
export function EtiquetasForm({ cola, impresora }: { cola: Trabajo[]; impresora: string }) {
  const [error, setError] = useState<string | null>(null)
  const [logro, setLogro] = useState<string | null>(null)
  const [pending, empezar] = useTransition()

  const llevar = async (trabajo: Trabajo) => {
    const entrega = await entregarALaImpresora(impresora, trabajo.zpl)
    await marcarEntrega(trabajo.id, entrega.ok ? null : entrega.error)
    if (entrega.ok) setLogro(`${trabajo.titulo}: mandada a la impresora.`)
    else setError(entrega.error)
  }

  const prueba = () => {
    setError(null)
    setLogro(null)
    empezar(async () => {
      const res = await imprimirPrueba()
      if (!res.ok) return setError(res.error)
      await llevar(res.trabajo)
    })
  }

  const delPallet = (matricula: string) => {
    if (!matricula.trim()) return
    setError(null)
    setLogro(null)
    empezar(async () => {
      const res = await imprimirEtiquetaDePallet(matricula)
      if (!res.ok) return setError(res.error)
      await llevar(res.trabajo)
    })
  }

  const reintentar = (trabajo: Trabajo) => {
    setError(null)
    setLogro(null)
    empezar(async () => {
      await llevar(trabajo)
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {impresora ? null : (
        <Aviso>Este despliegue todavía no tiene impresora configurada.</Aviso>
      )}

      <ScanInput
        label="Escanea la matrícula del pallet"
        disabled={pending || !impresora}
        onScan={delPallet}
      />

      <button type="button" onClick={prueba} disabled={pending || !impresora} className={BOTON}>
        Imprimir etiqueta de prueba
      </button>

      {error ? <Aviso>{error}</Aviso> : null}
      {logro ? <Logro>{logro}</Logro> : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm text-azul/60">Últimas etiquetas</h2>
        {cola.length === 0 ? (
          <p className="text-sm text-azul/60">Todavía no se ha mandado ninguna.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-borde text-sm">
            {cola.map((t) => (
              <li key={t.id} className="flex flex-col gap-2 py-3">
                <div className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1 truncate">{t.titulo}</span>
                  <span className="shrink-0 text-azul/60">{ESTADO[t.estado]}</span>
                  <span className="w-28 shrink-0 text-right tabular-nums text-azul/60">
                    {fechaYHora(t.cuando)}
                  </span>
                </div>
                {t.error ? <p className="text-azul/60">{t.error}</p> : null}
                {t.estado === 'impresa' ? null : (
                  <button
                    type="button"
                    onClick={() => reintentar(t)}
                    disabled={pending || !impresora}
                    className={BOTON_SUAVE}
                  >
                    Volver a mandarla
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
