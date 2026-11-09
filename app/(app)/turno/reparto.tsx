'use client'

import { useState, useTransition } from 'react'
import { ROLE_LABELS, type UserRole } from '@/lib/auth/roles'
import { Aviso, Logro } from '@/components/ui/feedback'
import { CAMPO } from '@/components/ui/campos'
import { asignarAnden } from './actions'

export type Persona = {
  id: string
  nombre: string
  rol: UserRole
  disponible: boolean
  motivo: string | null
  equipo: string | null
  anden: string | null
}

export type Carga = {
  anden: string
  libres: number
  asignadas: number
  enCurso: number
  personas: number
}

/**
 * El reparto del jefe de bodega.
 *
 * No es un horario ni una planilla: es dónde está parada cada persona ahora mismo, y se
 * cambia a media mañana sin pedirle permiso a nadie. Para decidirlo no sirve saber que hay
 * 40 tareas abiertas en la bodega; sirve ver que 31 están en el andén 6 y que ahí hay una
 * sola persona. Por eso cada andén dice su carga, y cada opción del selector también.
 *
 * Las tareas son del andén, no de la persona: al mover a alguien, lo que tenía asignado y no
 * había empezado vuelve a la cola de su andén para que se lo lleve quien quede ahí. Lo que ya
 * empezó no se le toca, porque cancelarle una tarea a alguien que va con un pallet en las
 * uñas deja ese pallet a medio camino y sin dueño.
 */
export function Reparto({ gente, carga }: { gente: Persona[]; carga: Carga[] }) {
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, empezar] = useTransition()

  const porAnden = new Map(carga.map((c) => [c.anden, c]))
  const conTrabajo = carga
    .filter((c) => c.libres + c.asignadas + c.enCurso > 0)
    .sort((a, b) => b.libres - a.libres)

  const mover = (persona: Persona, anden: string) => {
    setAviso(null)
    setError(null)
    empezar(async () => {
      const res = await asignarAnden(persona.id, anden)
      if (!res.ok) return setError(res.error)

      const nombre = persona.nombre.split(' ')[0]
      const donde = res.anden ?? 'toda la bodega'
      const partes = [`${nombre} pasa a ${donde}.`]
      if (res.liberadas > 0) {
        partes.push(
          res.liberadas === 1
            ? 'Soltó 1 tarea que no había empezado y vuelve a la cola del andén que deja.'
            : `Soltó ${res.liberadas} tareas que no había empezado y vuelven a la cola del andén que deja.`,
        )
      }
      if (res.enCurso) {
        partes.push(`Anda a medio camino con algo para ${res.enCurso}: lo termina y pasa.`)
      }
      setAviso(partes.join(' '))
    })
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg">Quién está y dónde</h2>
        <p className="text-sm text-azul/60">
          El andén filtra las tareas de guardar y surtir. Muévelos donde se esté acumulando.
        </p>
      </div>

      {conTrabajo.length > 0 ? (
        <ul className="flex flex-col divide-y divide-borde rounded-2xl border border-borde px-3">
          {conTrabajo.map((c) => (
            <li key={c.anden} className="flex items-baseline gap-3 py-2.5 text-sm">
              <span className="w-24 shrink-0 tabular-nums">{c.anden}</span>
              <span className="min-w-0 flex-1 text-azul/60">
                {c.personas === 0
                  ? 'sin nadie'
                  : c.personas === 1
                    ? '1 persona'
                    : `${c.personas} personas`}
              </span>
              <span className="shrink-0 tabular-nums">
                {c.libres > 0 ? `${c.libres} sin tomar` : 'al día'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-azul/60">Ningún andén tiene trabajo pendiente ahora.</p>
      )}

      {aviso ? <Logro>{aviso}</Logro> : null}
      {error ? <Aviso>{error}</Aviso> : null}

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
              <select
                value={p.anden ?? ''}
                disabled={pending}
                onChange={(e) => mover(p, e.target.value)}
                aria-label={`Andén de ${p.nombre}`}
                className={`${CAMPO} w-44 shrink-0 disabled:opacity-50`}
              >
                <option value="">Toda la bodega</option>
                {carga.map((c) => (
                  <option key={c.anden} value={c.anden}>
                    {c.anden}
                    {(porAnden.get(c.anden)?.libres ?? 0) > 0
                      ? ` · ${porAnden.get(c.anden)?.libres} sin tomar`
                      : ''}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
