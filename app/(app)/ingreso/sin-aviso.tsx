'use client'

import { useState, useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'
import { BotonCamara } from '@/components/ui/boton-camara'
import { Aviso } from '@/components/ui/feedback'
import { BOTON, BOTON_SUAVE, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { buscarProducto, recibirSinAviso, type Producto, type Recibido } from './actions'

/**
 * Recibir un camión que nadie anunció.
 *
 * Al revés del ingreso normal: ahí la hoja dice qué trae cada pallet y el operario sólo
 * confirma escaneando. Aquí no hay hoja, así que el dato lo pone quien está descargando, y
 * el orden importa —primero qué es, después cuánto— porque saber el producto es lo que
 * permite al sistema decir si hace falta el vencimiento.
 */
export function SinAviso({
  pedido,
  dockLocationId,
  onRecibido,
}: {
  pedido: string
  dockLocationId: string
  onRecibido: (recibido: Recibido) => void
}) {
  const [producto, setProducto] = useState<Producto | null>(null)
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, empezar] = useTransition()

  const identificar = (texto: string) => {
    if (!texto.trim()) return
    setError(null)
    empezar(async () => {
      const res = await buscarProducto(texto)
      if (!res.ok) return setError(res.error)
      setCodigo(texto.trim())
      setProducto(res.producto)
    })
  }

  const limpiar = () => {
    setProducto(null)
    setCodigo('')
    setError(null)
  }

  const recibir = (datos: FormData) => {
    setError(null)
    empezar(async () => {
      const res = await recibirSinAviso({
        pedido,
        codigo,
        cases: String(datos.get('cases') ?? ''),
        dockLocationId,
        lot: String(datos.get('lot') ?? ''),
        expiry: String(datos.get('expiry') ?? ''),
        palletCode: String(datos.get('palletCode') ?? ''),
      })
      if (!res.ok) return setError(res.error)
      onRecibido(res.recibido)
      limpiar()
    })
  }

  if (!producto) {
    return (
      <div className="flex flex-col gap-3">
        <ScanInput
          label="Escanea una caja del pallet"
          disabled={pending}
          onScan={identificar}
        />
        <p className="text-sm text-azul/60">
          Si el código no aparece o lo comparten dos productos, escribe el SKU con el teclado.
        </p>
        {error ? <Aviso>{error}</Aviso> : null}
      </div>
    )
  }

  return (
    <form action={recibir} className="flex flex-col gap-4">
      <div className="rounded-2xl border border-borde p-4">
        <p className="text-sm text-azul/60">{producto.sku}</p>
        <p>{producto.name}</p>
        <button
          type="button"
          onClick={limpiar}
          className="mt-1 text-sm underline underline-offset-4"
        >
          No es este
        </button>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={ETIQUETA}>Cajas en el pallet</span>
        <input
          name="cases"
          autoFocus
          required
          inputMode="numeric"
          className={`${CAMPO} tabular-nums`}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={ETIQUETA}>Lote</span>
          <input name="lot" className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ETIQUETA}>
            Vencimiento{producto.exigeVencimiento ? '' : ' (si lo trae)'}
          </span>
          <input
            name="expiry"
            type="date"
            required={producto.exigeVencimiento}
            className={CAMPO}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={ETIQUETA}>Etiqueta del pallet (si trae una legible)</span>
        <span className="flex gap-2">
          <input name="palletCode" className={`${CAMPO} flex-1`} />
          <BotonCamara campo="palletCode" />
        </span>
      </label>

      <button type="submit" disabled={pending} className={BOTON}>
        {pending ? 'Recibiendo...' : 'Recibir pallet'}
      </button>

      <p className="text-sm text-azul/60">
        Sin etiqueta también se recibe: el sistema le pone matrícula y el pallet queda
        identificado por dónde se guarde.
      </p>

      {error ? <Aviso>{error}</Aviso> : null}

      <button type="button" onClick={limpiar} className={BOTON_SUAVE}>
        Cancelar
      </button>
    </form>
  )
}
