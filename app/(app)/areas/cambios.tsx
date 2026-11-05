'use client'

import { useActionState } from 'react'
import { Aviso, Logro } from '@/components/ui/feedback'
import { BOTON, BOTON_SUAVE, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { cambiarUso, moverArea } from './actions'

export type Opcion = { code: string; name: string }

/**
 * Los dos cambios que el jefe hace sobre un rango de posiciones ya visto: a qué área
 * pertenecen y para qué sirven. El rango viaja oculto, así que lo que se cambia es
 * exactamente lo que la pantalla acaba de contar.
 */
export function Cambios({
  patron,
  areas,
  usos,
}: {
  patron: string
  areas: Opcion[]
  usos: Opcion[]
}) {
  const [area, accionArea, moviendo] = useActionState(moverArea, null)
  const [uso, accionUso, cambiando] = useActionState(cambiarUso, null)

  return (
    <div className="flex flex-col gap-4">
      <form action={accionArea} className="flex flex-col gap-2">
        <input type="hidden" name="patron" value={patron} />
        <label className={ETIQUETA} htmlFor="area">
          Mover a un área
        </label>
        <select id="area" name="area" className={CAMPO} defaultValue="">
          <option value="" disabled>
            Elige el área
          </option>
          {areas.map((a) => (
            <option key={a.code} value={a.code}>
              {a.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={moviendo} className={BOTON}>
          {moviendo ? 'Moviendo...' : 'Mover'}
        </button>
        {area?.ok ? <Logro>{area.movidas} posiciones movidas.</Logro> : null}
        {area && !area.ok ? <Aviso>{area.error}</Aviso> : null}
      </form>

      <form action={accionUso} className="flex flex-col gap-2">
        <input type="hidden" name="patron" value={patron} />
        <label className={ETIQUETA} htmlFor="uso">
          Para qué sirven
        </label>
        <select id="uso" name="uso" className={CAMPO} defaultValue="">
          <option value="" disabled>
            Elige el uso
          </option>
          {usos.map((u) => (
            <option key={u.code} value={u.code}>
              {u.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={cambiando} className={BOTON_SUAVE}>
          {cambiando ? 'Cambiando...' : 'Cambiar el uso'}
        </button>
        {uso?.ok ? <Logro>{uso.movidas} posiciones cambiadas.</Logro> : null}
        {uso && !uso.ok ? <Aviso>{uso.error}</Aviso> : null}
      </form>
    </div>
  )
}
