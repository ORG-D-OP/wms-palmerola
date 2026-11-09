'use client'

import { useState, useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'
import { BotonCamara } from '@/components/ui/boton-camara'
import { Aviso, Logro } from '@/components/ui/feedback'
import { BOTON, BOTON_SUAVE, CAMPO, ETIQUETA } from '@/components/ui/campos'
import {
  cargar,
  identificar,
  type Cargado,
  type Existente,
  type Producto,
  type Sugerencia,
} from './actions'

const fecha = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('es-HN') : '—'

/** Lo que ya está cargado de este producto, del que vence antes al que vence después. */
function Cargado({ filas }: { filas: Existente[] }) {
  if (filas.length === 0) return null

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm text-azul/60">Ya cargado de este producto</h2>
      <ul className="flex flex-col divide-y divide-borde text-sm">
        {filas.map((f) => (
          <li key={`${f.posicion}-${f.lote}-${f.vence}`} className="flex items-baseline gap-3 py-2">
            <span className="w-24 shrink-0 tabular-nums">{f.posicion}</span>
            <span className="w-24 shrink-0 tabular-nums text-azul/60">{fecha(f.vence)}</span>
            <span className="min-w-0 flex-1 truncate text-azul/60">
              {f.enPicking ? 'picking' : ''}
            </span>
            <span className="tabular-nums">{f.cajas.toLocaleString('es-HN')}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Cargar la bodega el día uno.
 *
 * El orden lo pone la gente, no el sistema: hay que meter primero lo que vence antes, y por
 * eso la pantalla enseña todo el tiempo lo que ya se cargó de ese producto con sus
 * vencimientos. Si alguien lo hace al revés, el aviso lo dice en el momento, que es cuando
 * todavía cuesta barato arreglarlo.
 */
export function CargaForm() {
  const [codigo, setCodigo] = useState('')
  const [producto, setProducto] = useState<Producto | null>(null)
  const [sugerencia, setSugerencia] = useState<Sugerencia>(null)
  const [cargado, setCargado] = useState<Existente[]>([])
  const [ultimo, setUltimo] = useState<Cargado | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, empezar] = useTransition()

  const buscar = (texto: string) => {
    if (!texto.trim()) return
    setError(null)
    empezar(async () => {
      const res = await identificar(texto)
      if (!res.ok) return setError(res.error)
      setCodigo(texto.trim())
      setProducto(res.producto)
      setSugerencia(res.sugerencia)
      setCargado(res.cargado)
      setUltimo(null)
    })
  }

  const limpiar = () => {
    setProducto(null)
    setSugerencia(null)
    setCargado([])
    setCodigo('')
    setError(null)
  }

  const guardar = (datos: FormData) => {
    setError(null)
    empezar(async () => {
      const res = await cargar({
        codigo,
        cases: String(datos.get('cases') ?? ''),
        posicion: String(datos.get('posicion') ?? ''),
        lot: String(datos.get('lot') ?? ''),
        expiry: String(datos.get('expiry') ?? ''),
        palletCode: String(datos.get('palletCode') ?? ''),
      })
      if (!res.ok) return setError(res.error)
      setUltimo(res.cargado)
      setCargado(res.cargadoDe)
      setSugerencia(null)
    })
  }

  if (!producto) {
    return (
      <div className="flex flex-col gap-3">
        <ScanInput label="Escanea una caja o escribe el SKU" disabled={pending} onScan={buscar} />
        <p className="text-sm text-azul/60">
          Mete primero lo que vence antes. Así lo más próximo queda en picking y en los niveles
          bajos, y el FEFO nace derecho: al revés, hay que bajar pallets de rack antes de
          despachar el primer camión.
        </p>
        {ultimo ? (
          <Logro>
            {ultimo.cases} cajas de {ultimo.sku} en {ultimo.posicion} · {ultimo.matricula}
          </Logro>
        ) : null}
        {error ? <Aviso>{error}</Aviso> : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <form action={guardar} className="flex flex-col gap-4">
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

        {ultimo ? (
          <Logro>
            {ultimo.cases} cajas en {ultimo.posicion} · {ultimo.matricula}
          </Logro>
        ) : null}
        {ultimo?.aviso ? <Aviso>{ultimo.aviso}</Aviso> : null}

        <label className="flex flex-col gap-1.5">
          <span className={ETIQUETA}>Cajas</span>
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
            <input name="lot" required className={CAMPO} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ETIQUETA}>Vencimiento</span>
            <input name="expiry" type="date" required className={CAMPO} />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={ETIQUETA}>Posición</span>
          <span className="flex gap-2">
            <input
              name="posicion"
              required
              defaultValue={sugerencia?.posicion ?? ''}
              className={`${CAMPO} flex-1`}
            />
            <BotonCamara campo="posicion" />
          </span>
          {sugerencia ? (
            <span className="text-sm text-azul/60">
              {sugerencia.esPicking
                ? 'Picking: este producto todavía no tiene posición de surtido, y el primer pallet debe ser el que vence antes.'
                : 'Sugerida por el sistema. Si lo pusieron en otra, escanea esa.'}
            </span>
          ) : null}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={ETIQUETA}>Etiqueta del pallet (opcional)</span>
          <span className="flex gap-2">
            <input name="palletCode" className={`${CAMPO} flex-1`} />
            <BotonCamara campo="palletCode" />
          </span>
        </label>

        <button type="submit" disabled={pending} className={BOTON}>
          {pending ? 'Cargando...' : 'Cargar aquí'}
        </button>

        {error ? <Aviso>{error}</Aviso> : null}

        <button type="button" onClick={limpiar} className={BOTON_SUAVE}>
          Otro producto
        </button>
      </form>

      <Cargado filas={cargado} />
    </div>
  )
}
