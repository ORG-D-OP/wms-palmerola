'use client'

import { useState, useTransition } from 'react'
import { Aviso } from '@/components/ui/feedback'
import { BOTON_SUAVE, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { ponerClase, type Producto } from './actions'

/**
 * Qué es el producto, para saber dónde se guarda.
 *
 * Lo que no es alimento no duerme al lado de la comida, y eso sale de `contamination_class`.
 * Un producto que llegó en un camión sin estar en el maestro no trae ninguna, y por omisión se
 * guarda como alimento: el andén es el único sitio donde alguien lo tiene delante.
 */
export const CLASES = [
  { valor: 'ALIMENTO', etiqueta: 'Alimento' },
  { valor: 'NO_ALIMENTO', etiqueta: 'No es alimento' },
  { valor: 'QUIMICO', etiqueta: 'Químico o limpieza' },
  { valor: 'AROMATICO', etiqueta: 'Huele fuerte' },
] as const

export function CampoClase({ name = 'clase' }: { name?: string }) {
  return (
    <label className="mt-3 flex flex-col gap-1.5">
      <span className={ETIQUETA}>Qué es</span>
      <select name={name} required defaultValue="" className={CAMPO}>
        <option value="" disabled>
          Elige para saber dónde va
        </option>
        {CLASES.map((c) => (
          <option key={c.valor} value={c.valor}>
            {c.etiqueta}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Los productos del camión que todavía no dicen qué son. */
export function FaltaDecirQueEs({
  productos,
  onHecho,
}: {
  productos: Producto[]
  onHecho: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, empezar] = useTransition()

  const guardar = (id: string) => (datos: FormData) => {
    setError(null)
    empezar(async () => {
      const res = await ponerClase(id, String(datos.get('clase') ?? ''))
      if (!res.ok) return setError(res.error)
      onHecho()
    })
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-borde p-4">
      <div>
        <h2 className={ETIQUETA}>Falta decir qué es</h2>
        <p className="text-sm text-azul/60">
          Estos llegaron sin estar en el maestro. Mientras nadie lo diga se guardan con la
          comida; dicho aquí, van a su sitio desde el primer pallet.
        </p>
      </div>
      {productos.map((p) => (
        <form key={p.id} action={guardar(p.id)} className="flex flex-col gap-2">
          <div>
            <p className="text-sm text-azul/60 tabular-nums">{p.sku}</p>
            <p>{p.name}</p>
          </div>
          <CampoClase />
          <button type="submit" disabled={pending} className={BOTON_SUAVE}>
            {pending ? 'Guardando...' : 'Guardar'}
          </button>
        </form>
      ))}
      {error ? <Aviso>{error}</Aviso> : null}
    </section>
  )
}
