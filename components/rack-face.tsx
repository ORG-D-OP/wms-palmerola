'use client'

import { useState } from 'react'
import { Icon } from './ui/icon'

export type Celda = {
  code: string
  bahia: number
  nivel: number
  fondo: number
  sku: string | null
  name: string | null
  lot: string | null
  expiry: string | null
  lpn: string | null
  apartada: boolean
  uso: string
}

export type Cara = {
  zona: string
  carril: string
  niveles: number
  bahias: number
  fondos: number
  celdas: Celda[]
}

const ESTADO = {
  libre: 'bg-white',
  ocupada: 'bg-azul text-white',
  apartada: 'bg-celeste/40',
  otroUso: 'bg-azul-08 text-azul/40',
}

function claseDe(c: Celda | undefined) {
  if (!c) return 'bg-transparent'
  if (c.uso !== 'PRODUCTO') return ESTADO.otroUso
  if (c.sku) return ESTADO.ocupada
  if (c.apartada) return ESTADO.apartada
  return ESTADO.libre
}

/**
 * La cara del rack, como la ve el montacarguista al llegar al pasillo: las bahías de
 * izquierda a derecha, los niveles de abajo hacia arriba y cada posición partida en frente
 * y fondo, porque el rack es de doble profundidad y lo del fondo sale después.
 *
 * La vista de planta no puede mostrar esto: en planta, seis niveles son un solo cuadro.
 */
export function RackFace({ cara, destino }: { cara: Cara; destino?: string }) {
  const [elegida, setElegida] = useState<Celda | null>(null)

  const porClave = new Map(
    cara.celdas.map((c) => [`${c.bahia}|${c.nivel}|${c.fondo}`, c]),
  )
  const niveles = Array.from({ length: cara.niveles }, (_, i) => cara.niveles - i)
  const bahias = Array.from({ length: cara.bahias }, (_, i) => i + 1)
  const fondos = Array.from({ length: cara.fondos }, (_, i) => i + 1)

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto pb-1">
        <table className="border-separate border-spacing-0.5">
          <caption className="sr-only">
            Cara del carril {cara.carril}: {cara.bahias} bahías por {cara.niveles} niveles
          </caption>
          <tbody>
            {niveles.map((n) => (
              <tr key={n}>
                <th scope="row" className="pr-1.5 text-right text-[11px] font-normal text-azul/50">
                  N{n}
                </th>
                {bahias.map((b) => (
                  <td key={b} className="p-0">
                    <span className="flex gap-px">
                      {fondos.map((p) => {
                        const c = porClave.get(`${b}|${n}|${p}`)
                        const esDestino = c?.code === destino
                        return (
                          <button
                            key={p}
                            type="button"
                            disabled={!c}
                            onClick={() => setElegida(c ?? null)}
                            title={c?.code}
                            aria-label={
                              c ? `${c.code}${c.sku ? `, ${c.sku}` : ', libre'}` : 'sin posición'
                            }
                            className={`h-7 w-4 rounded-[3px] border border-borde/60 ${claseDe(c)} ${
                              esDestino ? 'ring-2 ring-[var(--verde)]' : ''
                            } ${elegida?.code === c?.code && c ? 'outline outline-2 outline-azul' : ''}`}
                          />
                        )
                      })}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td />
              {bahias.map((b) => (
                <td key={b} className="pt-0.5 text-center text-[10px] text-azul/50 tabular-nums">
                  {b}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-azul/60">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-[3px] border border-borde bg-white" /> libre
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-[3px] bg-azul" /> ocupada
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-[3px] bg-celeste/40" /> apartada
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-[3px] bg-azul-08" /> otro uso
        </span>
        <span>Cada bahía son {cara.fondos} posiciones: frente y fondo.</span>
      </div>

      {elegida ? (
        <div className="flex items-start gap-3 rounded-2xl border border-borde p-4">
          <Icon name="shelves" className="shrink-0 text-azul/60" />
          <div className="min-w-0 flex-1">
            <p className="text-lg tabular-nums">{elegida.code}</p>
            <p className="text-sm text-azul/60">
              Bahía {elegida.bahia}, nivel {elegida.nivel},{' '}
              {elegida.fondo === 1 ? 'al frente' : 'al fondo'}
            </p>
            {elegida.sku ? (
              <>
                <p className="mt-2">{elegida.name}</p>
                <p className="text-sm text-azul/60">
                  {elegida.sku}
                  {elegida.lot ? ` · lote ${elegida.lot}` : ''}
                  {elegida.expiry ? ` · vence ${elegida.expiry}` : ''}
                </p>
                {elegida.lpn ? (
                  <p className="font-mono text-xs text-azul/60">{elegida.lpn}</p>
                ) : null}
              </>
            ) : (
              <p className="mt-2 text-sm text-azul/60">
                {elegida.uso !== 'PRODUCTO'
                  ? 'Reservada para otro uso.'
                  : elegida.apartada
                    ? 'Apartada por una tarea.'
                    : 'Libre.'}
              </p>
            )}
            {elegida.fondo > 1 ? (
              <p className="mt-2 text-sm text-azul/70">
                Está detrás: hay que bajar primero el pallet de enfrente.
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setElegida(null)}
            aria-label="Cerrar"
            className="shrink-0 text-azul/60"
          >
            <Icon name="close" />
          </button>
        </div>
      ) : null}
    </div>
  )
}
