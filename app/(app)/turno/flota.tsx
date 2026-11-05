'use client'

import { useActionState } from 'react'
import { Aviso } from '@/components/ui/feedback'
import { BOTON_SUAVE, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { cambiarEstadoEquipo, registrarEquipo } from './actions'
import type { Equipo } from './turno-form'

export type Tipo = { code: string; name: string; alcance: number }

/**
 * La flota la registra el jefe de bodega: cuántos montacargas hay y de qué tipo no es algo
 * que el sistema pueda suponer, y de eso depende quién recibe tareas de rack.
 */
export function Flota({ equipos, tipos }: { equipos: Equipo[]; tipos: Tipo[] }) {
  const [estado, accion, pending] = useActionState(registrarEquipo, null)

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg">Flota</h2>

      {equipos.length > 0 ? (
        <ul className="flex flex-col divide-y divide-borde text-sm">
          {equipos.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-2">
              <span className="w-20 shrink-0 font-mono">{e.code}</span>
              <span className="min-w-0 flex-1">
                <span className="block">{e.tipo}</span>
                <span className="block text-xs text-azul/60">
                  {e.alcance === 0 ? 'Solo piso' : `Alcanza el nivel ${e.alcance}`}
                  {e.libre ? '' : ' · en turno'}
                </span>
              </span>
              <form action={cambiarEstadoEquipo}>
                <input type="hidden" name="id" value={e.id} />
                <input type="hidden" name="activo" value="0" />
                <button className="text-xs underline underline-offset-4">Dar de baja</button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-azul/60">Sin montacargas registrados.</p>
      )}

      <form action={accion} className="flex flex-col gap-3 rounded-2xl border border-borde p-4">
        <div className="flex gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={ETIQUETA}>Código</span>
            <input name="code" required maxLength={20} placeholder="MC-01" className={CAMPO} />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={ETIQUETA}>Tipo</span>
            <select name="tipo" className={CAMPO}>
              {tipos.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="submit" disabled={pending} className={BOTON_SUAVE}>
          {pending ? 'Guardando...' : 'Agregar equipo'}
        </button>
        {estado && !estado.ok ? <Aviso>{estado.error}</Aviso> : null}
      </form>
    </section>
  )
}
