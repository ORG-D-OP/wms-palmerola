'use client'

import { useActionState } from 'react'
import { Aviso, Logro } from '@/components/ui/feedback'
import { BOTON_SUAVE, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { ajustarAviso } from './actions'

/**
 * El listón del aviso.
 *
 * Es un dato del área y no un número escondido en el código porque la bodega todavía no sabe
 * a qué altura le sirve: se empieza en la mitad y el jefe lo mueve según cómo le vaya.
 */
export function Umbral({ area, pct }: { area: string; pct: number }) {
  const [estado, guardar, pending] = useActionState(ajustarAviso, null)

  return (
    <form action={guardar} className="flex flex-col gap-3 rounded-2xl border border-borde p-4">
      <input type="hidden" name="area" value={area} />
      <div className="flex items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className={ETIQUETA}>Avisar por debajo de</span>
          <div className="flex items-center gap-2">
            <input
              name="pct"
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              required
              defaultValue={pct}
              className={`${CAMPO} w-24`}
            />
            <span className="text-azul/60">% de lo que cabe</span>
          </div>
        </label>
        <button type="submit" disabled={pending} className={BOTON_SUAVE}>
          {pending ? 'Guardando...' : 'Cambiar'}
        </button>
      </div>
      {estado?.ok ? <Logro>El aviso queda en {estado.pct}%.</Logro> : null}
      {estado && !estado.ok ? <Aviso>{estado.error}</Aviso> : null}
    </form>
  )
}
