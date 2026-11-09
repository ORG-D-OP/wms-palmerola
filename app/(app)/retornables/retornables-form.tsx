'use client'

import { useState, useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'
import { Aviso } from '@/components/ui/feedback'
import { BOTON, BOTON_SUAVE, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { buscarEspacio, contarRetornable, type Espacio } from './actions'

/**
 * Pallets vacíos y corrugado: escanear el espacio y decir cuántas. No hay matrícula que
 * escanear ni lote que escribir, porque un pallet vacío no es producto: es una cuenta.
 */
export function RetornablesForm() {
  const [espacio, setEspacio] = useState<Espacio | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, empezar] = useTransition()

  const abrir = (codigo: string) => {
    if (!codigo.trim()) return
    setError(null)
    empezar(async () => {
      const res = await buscarEspacio(codigo)
      if (!res.ok) return setError(res.error)
      setEspacio(res.espacio)
    })
  }

  const mover = (signo: 1 | -1) => (datos: FormData) => {
    if (!espacio) return
    setError(null)
    empezar(async () => {
      const res = await contarRetornable({
        posicion: espacio.code,
        delta: signo * Number(datos.get('cuantas') ?? 0),
      })
      if (!res.ok) return setError(res.error)
      setEspacio(res.espacio)
    })
  }

  if (!espacio) {
    return (
      <div className="flex flex-col gap-3">
        <ScanInput label="Escanea el espacio" disabled={pending} onScan={abrir} />
        <p className="text-sm text-azul/60">
          El espacio no tiene tope: caben todos los que sea. Lo que se lleva es la cuenta.
        </p>
        {error ? <Aviso>{error}</Aviso> : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl bg-azul-08 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-azul/60">{espacio.uso}</p>
          <button
            type="button"
            onClick={() => {
              setEspacio(null)
              setError(null)
            }}
            className="text-sm underline underline-offset-4"
          >
            Otro espacio
          </button>
        </div>
        <p className="text-lg tabular-nums">{espacio.code}</p>
        <p className="mt-2 text-5xl tabular-nums">{espacio.cantidad.toLocaleString('es-HN')}</p>
      </div>

      <form className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className={ETIQUETA}>¿Cuántas?</span>
          <input
            name="cuantas"
            autoFocus
            required
            inputMode="numeric"
            className={`${CAMPO} tabular-nums`}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <button formAction={mover(1)} disabled={pending} className={BOTON}>
            Guardar aquí
          </button>
          <button formAction={mover(-1)} disabled={pending} className={BOTON_SUAVE}>
            Quitar de aquí
          </button>
        </div>
      </form>

      {error ? <Aviso>{error}</Aviso> : null}
    </div>
  )
}
