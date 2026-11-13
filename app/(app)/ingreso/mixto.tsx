'use client'

import { useState, useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'
import { Aviso } from '@/components/ui/feedback'
import { BOTON, BOTON_SUAVE, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { buscarProducto, recibirMixto, type Pieza } from './actions'

type Renglon = {
  codigo: string
  sku: string
  name: string
  cases: string
  lot: string
  expiry: string
}

/**
 * El pallet que trae más de un producto.
 *
 * Es la excepción, no la regla: los archivos no delatan un mixto y de la planta con etiqueta
 * Nest no sale ninguno, así que esto se abre desde un enlace discreto y la pantalla de todos
 * los días no cambia.
 *
 * Se apunta producto por producto lo que trae, y al recibirlo el pallet se desarma: cada
 * producto sale como su propio pallet, con su matrícula y su posición, porque del almacén sólo
 * salen pallets completos de un producto. La etiqueta que traía el camión queda como la madre
 * de todos ellos.
 */
export function Mixto({
  pedido,
  dockLocationId,
  palletCode,
  onRecibido,
  onCancelar,
}: {
  pedido: string
  dockLocationId: string
  palletCode: string | null
  onRecibido: () => void
  onCancelar: () => void
}) {
  const [renglones, setRenglones] = useState<Renglon[]>([])
  const [producto, setProducto] = useState<{ codigo: string; sku: string; name: string } | null>(
    null,
  )
  const [hecho, setHecho] = useState<{ madre: string; piezas: Pieza[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, empezar] = useTransition()

  const identificar = (texto: string) => {
    if (!texto.trim()) return
    setError(null)
    empezar(async () => {
      const res = await buscarProducto(texto)
      if (!res.ok) return setError(res.error)
      setProducto({ codigo: texto.trim(), ...res.producto })
    })
  }

  const agregar = (datos: FormData) => {
    if (!producto) return
    setRenglones((previos) => [
      ...previos,
      {
        codigo: producto.codigo,
        sku: producto.sku,
        name: producto.name,
        cases: String(datos.get('cases') ?? ''),
        lot: String(datos.get('lot') ?? ''),
        expiry: String(datos.get('expiry') ?? ''),
      },
    ])
    setProducto(null)
  }

  const recibir = () => {
    setError(null)
    empezar(async () => {
      const res = await recibirMixto({
        pedido,
        dockLocationId,
        palletCode: palletCode ?? '',
        productos: renglones,
      })
      if (!res.ok) return setError(res.error)
      setHecho({ madre: res.madre, piezas: res.piezas })
    })
  }

  if (hecho) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-borde p-4">
        <div>
          <p className={ETIQUETA}>El pallet {hecho.madre} se desarmó en {hecho.piezas.length}</p>
          <p className="text-sm text-azul/70">
            Ponle a cada uno su matrícula y llévalo a su posición.
          </p>
        </div>

        <ul className="flex flex-col divide-y divide-borde">
          {hecho.piezas.map((p) => (
            <li key={p.lpnCode} className="flex items-baseline justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate">{p.name}</span>
                <span className="block text-sm text-azul/60">
                  {p.sku} · {p.cases} cajas
                </span>
                <span className="block font-mono text-xs">{p.lpnCode}</span>
              </span>
              <span className="shrink-0 text-lg tabular-nums">
                {p.locationCode ?? 'Sin hueco libre'}
              </span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => {
            setHecho(null)
            setRenglones([])
            onRecibido()
          }}
          className={BOTON}
        >
          Listo
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-borde p-4">
      <div>
        <p className={ETIQUETA}>Pallet mixto</p>
        <p className="text-sm text-azul/70">
          Apunta cada producto que trae. Al recibirlo se desarma: cada uno sale como su propio
          pallet, porque del almacén sólo salen pallets completos de un producto.
        </p>
      </div>

      {renglones.length > 0 ? (
        <ul className="flex flex-col divide-y divide-borde">
          {renglones.map((r, i) => (
            <li key={`${r.codigo}-${i}`} className="flex items-baseline justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate">{r.name}</span>
                <span className="block text-sm text-azul/60 tabular-nums">
                  {r.cases} cajas · vence {r.expiry}
                  {r.lot ? ` · lote ${r.lot}` : ''}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setRenglones((previos) => previos.filter((_, j) => j !== i))}
                className="shrink-0 text-sm underline underline-offset-4"
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {producto ? (
        <form action={agregar} className="flex flex-col gap-3">
          <div>
            <p className="text-sm text-azul/60">{producto.sku}</p>
            <p>{producto.name}</p>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className={ETIQUETA}>Cajas de este producto</span>
            <input
              name="cases"
              autoFocus
              required
              inputMode="numeric"
              className={`${CAMPO} tabular-nums`}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className={ETIQUETA}>Vencimiento</span>
              <input name="expiry" type="date" required className={CAMPO} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ETIQUETA}>Lote, si viene impreso</span>
              <input name="lot" className={CAMPO} />
            </label>
          </div>
          <button type="submit" className={BOTON_SUAVE}>
            Añadir al pallet
          </button>
          <button
            type="button"
            onClick={() => setProducto(null)}
            className="text-sm underline underline-offset-4"
          >
            No es este
          </button>
        </form>
      ) : (
        <ScanInput
          label="Escanea una caja o escribe el SKU"
          disabled={pending}
          onScan={identificar}
        />
      )}

      {error ? <Aviso>{error}</Aviso> : null}

      {renglones.length >= 2 && !producto ? (
        <button type="button" onClick={recibir} disabled={pending} className={BOTON}>
          {pending ? 'Recibiendo...' : `Recibir y desarmar: ${renglones.length} productos`}
        </button>
      ) : null}

      <button type="button" onClick={onCancelar} className="text-sm underline underline-offset-4">
        No es mixto: volver
      </button>
    </div>
  )
}
