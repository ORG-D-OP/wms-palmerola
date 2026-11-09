'use client'

import { useState, useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'
import { Aviso, Logro } from '@/components/ui/feedback'
import { Icon } from '@/components/ui/icon'
import { BOTON, BOTON_SUAVE } from '@/components/ui/campos'
import { ESTADO } from '../pedidos/estado'
import { buscarDespacho, despachar, recargarDespacho, type Camion } from './actions'

export function DespachoForm({ puedeCerrar }: { puedeCerrar: boolean }) {
  const [camion, setCamion] = useState<Camion | null>(null)
  const [error, setError] = useState('')
  const [pending, empezar] = useTransition()

  function resolver(respuesta: Awaited<ReturnType<typeof buscarDespacho>>) {
    if (respuesta.ok) {
      setCamion(respuesta.camion)
      setError('')
    } else {
      setError(respuesta.error)
    }
  }

  if (!camion) {
    return (
      <div className="flex flex-col gap-5">
        <ScanInput
          label="Escanea el código de la hoja de despacho"
          disabled={pending}
          onScan={(codigo) => empezar(async () => resolver(await buscarDespacho(codigo)))}
          formato="transporte"
        />
        <p className="text-sm text-azul/60">
          El código de barras de la hoja es el número de transporte. Si el mismo camión trae
          varias hojas, se abren todas juntas: no importa cuál tengas en la mano.
        </p>
        {error ? <Aviso>{error}</Aviso> : null}
      </div>
    )
  }

  const listo = camion.pendientes === 0
  const despachado = camion.estado === 'SHIPPED'

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1 rounded-2xl border border-borde p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-lg tabular-nums">{camion.transporte ?? camion.code}</span>
          <span className="shrink-0 rounded-md bg-azul-08 px-2 py-1 text-xs">
            {ESTADO[camion.estado as keyof typeof ESTADO] ?? camion.estado}
          </span>
        </div>
        <p className="text-sm text-azul/60">
          {camion.cliente ?? 'sin cliente'} · {camion.anden ?? 'sin andén'} · {camion.lineas}{' '}
          líneas
        </p>
        {camion.entregas.length > 0 ? (
          <p className="text-sm text-azul/60">Documentos: {camion.entregas.join(', ')}</p>
        ) : null}
      </div>

      <div className="flex gap-3">
        <Dato titulo="Pedido" valor={camion.pedido} />
        <Dato titulo="Surtido" valor={camion.surtido} />
        <Dato titulo="Tareas abiertas" valor={camion.pendientes} />
      </div>

      <ul className="flex flex-col divide-y divide-borde">
        {camion.detalle.map((l) => (
          <li key={l.lineNo} className="flex items-center gap-3 py-3">
            <Icon
              name={l.surtido >= l.pedido ? 'check_circle' : 'radio_button_unchecked'}
              className={l.surtido >= l.pedido ? 'text-azul' : 'text-azul/30'}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{l.name}</span>
              <span className="block text-sm text-azul/60">{l.sku}</span>
            </span>
            <span className="shrink-0 tabular-nums">
              {l.surtido} / {l.pedido}
            </span>
          </li>
        ))}
      </ul>

      {despachado ? (
        <Logro>El camión salió. No queda nada por hacer con esta hoja.</Logro>
      ) : puedeCerrar ? (
        <button
          type="button"
          disabled={pending || !listo}
          onClick={() => empezar(async () => resolver(await despachar(camion.id)))}
          className={BOTON}
        >
          {pending ? 'Despachando...' : 'Marcar camión despachado'}
        </button>
      ) : null}

      {!listo && !despachado ? (
        <p className="text-sm text-azul/60">
          Quedan {camion.pendientes} tareas de surtido abiertas. El camión no se puede cerrar
          hasta que terminen.
        </p>
      ) : null}

      {listo && !despachado && !puedeCerrar ? (
        <p className="text-sm text-azul/60">
          Ya está todo surtido. El camión lo cierra el chequeador con la hoja en la mano.
        </p>
      ) : null}

      <div className="flex gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => empezar(async () => resolver(await recargarDespacho(camion.id)))}
          className={BOTON_SUAVE}
        >
          <Icon name="refresh" />
          Actualizar
        </button>
        <button
          type="button"
          onClick={() => {
            setCamion(null)
            setError('')
          }}
          className={BOTON_SUAVE}
        >
          <Icon name="barcode_scanner" />
          Otro camión
        </button>
      </div>

      {error ? <Aviso>{error}</Aviso> : null}
    </div>
  )
}

function Dato({ titulo, valor }: { titulo: string; valor: number }) {
  return (
    <div className="flex flex-1 flex-col gap-1 rounded-2xl border border-borde p-3">
      <span className="text-sm text-azul/70">{titulo}</span>
      <span className="text-xl tabular-nums">{valor.toLocaleString('es-HN')}</span>
    </div>
  )
}
