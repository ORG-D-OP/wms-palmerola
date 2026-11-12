'use client'

import { useState, useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'
import { Aviso, Logro } from '@/components/ui/feedback'
import { BOTON_SUAVE } from '@/components/ui/campos'
import { mover, verLugar, type Cosa, type Hecho } from './actions'

const cantidad = (c: Cosa) =>
  [
    c.cajas > 0 ? `${c.cajas.toLocaleString('es-HN')} cajas` : null,
    c.sueltas > 0 ? `${c.sueltas.toLocaleString('es-HN')} sueltas` : null,
  ]
    .filter(Boolean)
    .join(' y ') || 'sin cajas completas'

/**
 * Reordenar: de dónde sale y a dónde va. Nada más.
 *
 * El producto, el lote y la cantidad no se teclean porque el sistema ya los sabe: se leen de
 * la existencia del lugar escaneado. Lo único que el lugar no dice es **cuál** pallet cuando
 * hay varios apilados, y para eso está el segundo paso, que sólo aparece cuando hace falta.
 */
export function ReordenarForm() {
  const [origen, setOrigen] = useState<string | null>(null)
  const [cosas, setCosas] = useState<Cosa[]>([])
  const [elegida, setElegida] = useState<Cosa | null>(null)
  const [hecho, setHecho] = useState<Hecho | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, empezar] = useTransition()

  const limpiar = () => {
    setOrigen(null)
    setCosas([])
    setElegida(null)
    setError(null)
  }

  const abrir = (codigo: string) => {
    if (!codigo.trim()) return
    setError(null)
    setHecho(null)
    empezar(async () => {
      const res = await verLugar(codigo)
      if (!res.ok) return setError(res.error)
      setOrigen(codigo.trim().toUpperCase())
      setCosas(res.cosas)
      setElegida(res.cosas.length === 1 ? (res.cosas[0] ?? null) : null)
    })
  }

  const llevar = (destino: string) => {
    if (!origen || !elegida || !destino.trim()) return
    setError(null)
    empezar(async () => {
      const res = await mover({
        origen,
        destino,
        pallet: elegida.pallet ?? undefined,
      })
      if (!res.ok) return setError(res.error)
      setHecho(res.hecho)
      limpiar()
    })
  }

  if (!origen) {
    return (
      <div className="flex flex-col gap-3">
        <ScanInput label="¿De dónde sale?" disabled={pending} onScan={abrir} />
        <p className="text-sm text-azul/60">
          La posición, o la matrícula del pallet si prefieres. El producto y la cantidad los
          pone el sistema.
        </p>
        {hecho ? (
          <Logro>
            {hecho.pallet} · {hecho.sku} {hecho.nombre} — de {hecho.de} a {hecho.a}.
          </Logro>
        ) : null}
        {error ? <Aviso>{error}</Aviso> : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl bg-azul-08 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-azul/60">Sale de</p>
          <button
            type="button"
            onClick={limpiar}
            className="text-sm underline underline-offset-4"
          >
            Otro lugar
          </button>
        </div>
        <p className="text-lg tabular-nums">{elegida?.posicion ?? origen}</p>
      </div>

      {elegida ? (
        <div className="flex flex-col gap-1 rounded-2xl border border-borde p-4">
          <p className="text-lg">
            {elegida.sku} {elegida.nombre}
          </p>
          <p className="text-sm text-azul/70">
            {elegida.pallet ? `${elegida.pallet} · ` : 'Sin pallet · '}
            {cantidad(elegida)}
          </p>
          {elegida.lote || elegida.vence ? (
            <p className="text-sm text-azul/60">
              {elegida.lote ? `Lote ${elegida.lote}` : ''}
              {elegida.lote && elegida.vence ? ' · ' : ''}
              {elegida.vence ? `Vence ${elegida.vence}` : ''}
            </p>
          ) : null}
          {cosas.length > 1 ? (
            <button
              type="button"
              onClick={() => setElegida(null)}
              className="mt-2 self-start text-sm underline underline-offset-4"
            >
              No es ese, es otro pallet
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-azul/70">
            Aquí hay {cosas.length} cosas. Escanea la matrícula del pallet que vas a mover, o
            tócalo en la lista.
          </p>
          <ul className="flex flex-col gap-2">
            {cosas.map((c) => (
              <li key={`${c.pallet ?? 'suelto'}-${c.sku}`}>
                <button
                  type="button"
                  onClick={() => setElegida(c)}
                  className={`${BOTON_SUAVE} h-auto flex-col items-start gap-0.5 px-4 py-3 text-left`}
                >
                  <span className="text-base">{c.pallet ?? 'Cajas sueltas'}</span>
                  <span className="text-sm text-azul/60">
                    {c.sku} {c.nombre} · {cantidad(c)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <ScanInput label="Matrícula del pallet" disabled={pending} onScan={abrir} />
        </div>
      )}

      {elegida ? (
        <ScanInput key="destino" label="¿A dónde va?" disabled={pending} onScan={llevar} />
      ) : null}

      {error ? <Aviso>{error}</Aviso> : null}
    </div>
  )
}
