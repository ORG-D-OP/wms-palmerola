'use client'

import { useState, useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'
import { Aviso } from '@/components/ui/feedback'
import { Icon } from '@/components/ui/icon'
import { BOTON, BOTON_SUAVE, CAMPO, ETIQUETA } from '@/components/ui/campos'
import {
  buscarIngreso,
  recibirPallet,
  type Documento,
  type Recibido,
} from './actions'

type Dock = { id: string; code: string }

export function IngresoForm({ docks }: { docks: Dock[] }) {
  const [dockId, setDockId] = useState(docks[0]?.id ?? '')
  const [doc, setDoc] = useState<Documento | null>(null)
  const [ultimo, setUltimo] = useState<Recibido | null>(null)
  const [verLista, setVerLista] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const abrir = (datos: FormData) => {
    setError(null)
    startTransition(async () => {
      const res = await buscarIngreso(String(datos.get('pedido') ?? ''))
      if (!res.ok) return setError(res.error)
      setDoc(res.doc)
      setUltimo(null)
    })
  }

  const escanearPallet = (code: string) => {
    if (!doc || !code.trim()) return
    setError(null)
    startTransition(async () => {
      const res = await recibirPallet({
        pedido: doc.pedido,
        palletCode: code,
        dockLocationId: dockId,
      })
      if (!res.ok) return setError(res.error)
      setUltimo(res.recibido)
      setDoc({
        ...doc,
        recibidos: res.recibido.recibidos,
        lineas: doc.lineas.map((l) =>
          l.palletCode.toUpperCase() === code.trim().toUpperCase()
            ? { ...l, recibido: true }
            : l,
        ),
      })
    })
  }

  if (!doc) {
    return (
      <div className="flex flex-col gap-5">
        <label className="flex flex-col gap-1.5">
          <span className={ETIQUETA}>Andén de descarga</span>
          <select value={dockId} onChange={(e) => setDockId(e.target.value)} className={CAMPO}>
            {docks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code}
              </option>
            ))}
          </select>
        </label>

        <form action={abrir} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={ETIQUETA}>Pedido del comprobante de carga</span>
            <input
              name="pedido"
              autoFocus
              inputMode="numeric"
              placeholder="60213772"
              className={`${CAMPO} tabular-nums`}
            />
          </label>
          <button type="submit" disabled={pending} className={BOTON}>
            {pending ? 'Buscando...' : 'Abrir ingreso'}
          </button>
        </form>

        <p className="text-sm text-azul/60">
          Son los ocho dígitos de la página que trae la lista de productos. Se teclea una vez
          por camión; después solo se escanean las etiquetas de los pallets.
        </p>

        {error ? <Aviso>{error}</Aviso> : null}
      </div>
    )
  }

  const faltan = doc.pallets - doc.recibidos
  const pendientes = doc.lineas.filter((l) => !l.recibido)

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl bg-azul-08 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-azul/60">Pedido</p>
          <button
            type="button"
            onClick={() => {
              setDoc(null)
              setUltimo(null)
              setError(null)
            }}
            className="text-sm underline underline-offset-4"
          >
            Cerrar
          </button>
        </div>
        <p className="text-2xl tabular-nums">{doc.pedido}</p>
        <p className="mt-2 text-sm">
          {doc.recibidos} de {doc.pallets} pallets · {doc.materiales} materiales ·{' '}
          {doc.cajas.toLocaleString('es-HN')} cajas
        </p>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-white"
          role="progressbar"
          aria-valuenow={doc.recibidos}
          aria-valuemax={doc.pallets}
        >
          <div
            className="h-full bg-[var(--verde)] transition-[width]"
            style={{ width: `${doc.pallets ? (doc.recibidos / doc.pallets) * 100 : 0}%` }}
          />
        </div>
      </div>

      {ultimo ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-borde p-4 text-center">
          <div>
            <p className="text-sm text-azul/60">{ultimo.sku}</p>
            <p>{ultimo.name}</p>
            <p className="text-sm text-azul/60">{ultimo.cases} cajas</p>
          </div>
          <div>
            <p className="text-sm text-azul/60">Llévalo a</p>
            <p className="text-4xl tabular-nums">{ultimo.locationCode ?? 'Sin hueco libre'}</p>
          </div>
        </div>
      ) : null}

      {faltan > 0 ? (
        <ScanInput
          label="Escanea la etiqueta del pallet"
          disabled={pending}
          onScan={escanearPallet}
        />
      ) : (
        <div className="flex flex-col gap-3 rounded-2xl bg-[var(--verde)]/20 p-4 text-center">
          <p className="text-lg">Camión completo</p>
          <p className="text-sm text-azul/70">
            Los {doc.pallets} pallets del pedido {doc.pedido} están recibidos.
          </p>
          <button
            type="button"
            onClick={() => {
              setDoc(null)
              setUltimo(null)
            }}
            className={BOTON_SUAVE}
          >
            Abrir otro pedido
          </button>
        </div>
      )}

      {error ? <Aviso>{error}</Aviso> : null}

      {pendientes.length > 0 ? (
        <section className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setVerLista(!verLista)}
            className="flex items-center gap-1.5 text-sm underline underline-offset-4"
          >
            <Icon name={verLista ? 'expand_less' : 'expand_more'} className="!text-[18px]" />
            {verLista ? 'Ocultar' : `Ver los ${pendientes.length} pallets que faltan`}
          </button>

          {verLista ? (
            <ul className="flex flex-col divide-y divide-borde text-sm">
              {pendientes.map((l) => (
                <li key={l.palletCode} className="flex items-baseline gap-3 py-2">
                  <span className="w-28 shrink-0 font-mono tabular-nums">{l.palletCode}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{l.name}</span>
                    <span className="block text-xs text-azul/60">
                      {l.sku} · {l.cases} cajas
                      {l.lot ? ` · lote ${l.lot}` : ''}
                      {l.expiry ? ` · vence ${l.expiry}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
