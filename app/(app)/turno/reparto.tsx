'use client'

import { ROLE_LABELS } from '@/lib/auth/roles'
import { CAMPO } from '@/components/ui/campos'
import { asignarAnden } from './actions'

export type Persona = {
  id: string
  nombre: string
  rol: keyof typeof ROLE_LABELS
  disponible: boolean
  motivo: string | null
  equipo: string | null
  anden: string | null
}

/**
 * El reparto del jefe de bodega.
 *
 * No es un horario ni una planilla: es dónde está parada cada persona ahora mismo, y se
 * cambia a media mañana sin pedirle permiso a nadie. El andén que se escoge aquí es lo que
 * filtra la cola: a quien está en el andén 1 no le cae un pallet del andén 6, al otro
 * extremo de una nave de 120 metros. Sin andén, la persona atiende toda la bodega.
 */
export function Reparto({ gente, andenes }: { gente: Persona[]; andenes: string[] }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg">Quién está y dónde</h2>
        <p className="text-sm text-azul/60">
          El andén filtra las tareas de guardar y surtir. Cámbialo cuando muevas a alguien.
        </p>
      </div>

      {gente.length === 0 ? (
        <p className="text-azul/60">Nadie ha entrado a trabajo todavía.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-borde">
          {gente.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{p.nombre}</span>
                <span className="block text-sm text-azul/60">
                  {ROLE_LABELS[p.rol]}
                  {p.equipo ? ` · ${p.equipo}` : ''}
                  {p.disponible ? '' : ` · no disponible${p.motivo ? `: ${p.motivo}` : ''}`}
                </span>
              </span>
              <form action={asignarAnden} className="shrink-0">
                <input type="hidden" name="persona" value={p.id} />
                <select
                  name="anden"
                  defaultValue={p.anden ?? ''}
                  onChange={(e) => e.currentTarget.form?.requestSubmit()}
                  className={`${CAMPO} w-36`}
                >
                  <option value="">Toda la bodega</option>
                  {andenes.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
