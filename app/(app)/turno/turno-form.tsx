'use client'

import { useActionState } from 'react'
import { Aviso, Logro } from '@/components/ui/feedback'
import { BOTON, BOTON_SUAVE, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { cerrarTurno, iniciarTurno } from './actions'

export type Equipo = { id: string; code: string; tipo: string; alcance: number; libre: boolean }

export type Turno = {
  equipo: string | null
  tipo: string | null
  alcance: number
  flujo: string
  desde: string
}

const FLUJOS = [
  { valor: 'BOTH', etiqueta: 'Los dos' },
  { valor: 'INBOUND', etiqueta: 'Ingreso' },
  { valor: 'OUTBOUND', etiqueta: 'Despacho' },
] as const

export function TurnoForm({ turno, equipos }: { turno: Turno | null; equipos: Equipo[] }) {
  const [estado, accion, pending] = useActionState(iniciarTurno, null)

  if (turno) {
    const hora = new Date(turno.desde).toLocaleTimeString('es-HN', {
      hour: '2-digit',
      minute: '2-digit',
    })

    return (
      <div className="flex flex-col gap-4 rounded-2xl border border-borde p-4">
        <Logro>Turno abierto desde las {hora}.</Logro>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className={ETIQUETA}>Equipo</dt>
            <dd className="text-lg">{turno.equipo ?? 'Sin equipo'}</dd>
          </div>
          <div>
            <dt className={ETIQUETA}>Alcance</dt>
            <dd className="text-lg">
              {turno.alcance === 0 ? 'Solo piso' : `Hasta el nivel ${turno.alcance}`}
            </dd>
          </div>
          <div>
            <dt className={ETIQUETA}>Le toca</dt>
            <dd className="text-lg">
              {FLUJOS.find((f) => f.valor === turno.flujo)?.etiqueta ?? turno.flujo}
            </dd>
          </div>
        </dl>

        <form action={cerrarTurno}>
          <button type="submit" className={BOTON_SUAVE}>
            Cerrar turno
          </button>
        </form>
      </div>
    )
  }

  const disponibles = equipos.filter((e) => e.libre)

  return (
    <form action={accion} className="flex flex-col gap-4 rounded-2xl border border-borde p-4">
      <p className="text-sm text-azul/70">
        Sin turno abierto solo se pueden tomar tareas de piso. El equipo define hasta qué
        nivel del rack te llegan tareas.
      </p>

      <label className="flex flex-col gap-1.5">
        <span className={ETIQUETA}>Equipo</span>
        <select name="equipo" defaultValue="" className={CAMPO}>
          <option value="">Sin equipo (solo piso)</option>
          {disponibles.map((e) => (
            <option key={e.id} value={e.code}>
              {e.code} · {e.tipo} · {e.alcance === 0 ? 'piso' : `nivel ${e.alcance}`}
            </option>
          ))}
        </select>
      </label>

      {equipos.length > 0 && disponibles.length === 0 ? (
        <p className="text-sm text-azul/60">
          Todos los equipos registrados están ocupados por otra persona.
        </p>
      ) : null}
      {equipos.length === 0 ? (
        <p className="text-sm text-azul/60">
          Todavía no hay montacargas registrados. Hasta que el jefe de bodega los dé de alta,
          nadie recibe tareas de rack.
        </p>
      ) : null}

      <fieldset className="flex flex-col gap-1.5">
        <legend className={ETIQUETA}>Qué te toca hoy</legend>
        <div className="flex gap-2">
          {FLUJOS.map((f, i) => (
            <label
              key={f.valor}
              className="flex h-14 flex-1 items-center justify-center gap-2 rounded-xl border border-borde has-checked:border-azul has-checked:bg-azul-08"
            >
              <input
                type="radio"
                name="flujo"
                value={f.valor}
                defaultChecked={i === 0}
                className="accent-azul"
              />
              <span>{f.etiqueta}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <button type="submit" disabled={pending} className={BOTON}>
        {pending ? 'Abriendo...' : 'Iniciar turno'}
      </button>

      {estado && !estado.ok ? <Aviso>{estado.error}</Aviso> : null}
    </form>
  )
}
