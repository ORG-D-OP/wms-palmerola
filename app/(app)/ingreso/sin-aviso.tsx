'use client'

import { useState, useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'
import { Aviso } from '@/components/ui/feedback'
import { BOTON, BOTON_SUAVE, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { buscarProducto, recibirSinAviso, type Producto, type Recibido } from './actions'

/**
 * Recibir un camión que nadie anunció.
 *
 * Al revés del ingreso normal: ahí la hoja dice qué trae cada pallet y el operario sólo
 * confirma escaneando. Aquí no hay hoja, así que el dato lo pone quien está descargando.
 *
 * Se escanea en el orden en que las cosas aparecen enfrente: primero la etiqueta del pallet,
 * que dice cuál es este bulto, y después una caja, que dice qué producto trae. Las dos
 * pueden faltar —el pallet llega sin etiqueta Nest, la caja trae un código que no está en el
 * maestro— y por eso ninguna detiene la descarga: lo que no puede faltar es el producto, que
 * entonces se escribe, y el vencimiento, de donde sale el FEFO.
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
  const [pallet, setPallet] = useState<string | null>(null)
  const [palletListo, setPalletListo] = useState(false)
  const [producto, setProducto] = useState<Producto | null>(null)
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, empezar] = useTransition()

  const tomarPallet = (texto: string) => {
    setPallet(texto.trim())
    setPalletListo(true)
    setError(null)
  }

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
    setPallet(null)
    setPalletListo(false)
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
        palletCode: pallet ?? '',
      })
      if (!res.ok) return setError(res.error)
      onRecibido(res.recibido)
      limpiar()
    })
  }

  if (!palletListo) {
    return (
      <div className="flex flex-col gap-3">
        <ScanInput label="Escanea la etiqueta del pallet" disabled={pending} onScan={tomarPallet} />
        <button type="button" onClick={() => setPalletListo(true)} className={BOTON_SUAVE}>
          No trae etiqueta
        </button>
        <p className="text-sm text-azul/60">
          Sin etiqueta el sistema le pone matrícula propia, y entonces el pallet se encuentra
          por dónde quedó guardado, no escaneándolo.
        </p>
        {error ? <Aviso>{error}</Aviso> : null}
      </div>
    )
  }

  const resumenPallet = (
    <div className="flex items-center justify-between rounded-2xl border border-borde p-4">
      <div>
        <p className={ETIQUETA}>Pallet</p>
        <p className={pallet ? 'tabular-nums' : 'text-azul/60'}>
          {pallet ?? 'Sin etiqueta: matrícula propia'}
        </p>
      </div>
      <button
        type="button"
        onClick={limpiar}
        className="text-sm underline underline-offset-4"
      >
        Cambiar
      </button>
    </div>
  )

  if (!producto) {
    return (
      <div className="flex flex-col gap-3">
        {resumenPallet}
        <ScanInput
          label="Escanea una caja o escribe el SKU"
          disabled={pending}
          onScan={identificar}
        />
        <p className="text-sm text-azul/60">
          Escanear es el atajo, no el requisito: con el botón del teclado se escribe el SKU.
          Hace falta si el código no está en el maestro o si lo comparten dos productos.
        </p>
        {error ? <Aviso>{error}</Aviso> : null}
      </div>
    )
  }

  return (
    <form action={recibir} className="flex flex-col gap-4">
      {resumenPallet}

      <div className="rounded-2xl border border-borde p-4">
        <p className="text-sm text-azul/60">{producto.sku}</p>
        <p>{producto.name}</p>
        <button
          type="button"
          onClick={() => {
            setProducto(null)
            setCodigo('')
          }}
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
          <span className={ETIQUETA}>Vencimiento</span>
          <input name="expiry" type="date" required className={CAMPO} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ETIQUETA}>Lote, si viene impreso</span>
          <input name="lot" className={CAMPO} />
        </label>
      </div>

      <button type="submit" disabled={pending} className={BOTON}>
        {pending ? 'Recibiendo...' : 'Recibir pallet'}
      </button>

      <p className="text-sm text-azul/60">
        El vencimiento es lo único que no puede quedar vacío: de ahí sale el FEFO y nadie lo
        reconstruye después. El lote va en blanco si el pallet no lo trae impreso, porque un
        lote inventado miente en la trazabilidad.
      </p>

      {error ? <Aviso>{error}</Aviso> : null}

      <button type="button" onClick={limpiar} className={BOTON_SUAVE}>
        Cancelar
      </button>
    </form>
  )
}
