'use client'

import { useActionState } from 'react'
import { Aviso, Logro } from '@/components/ui/feedback'
import { BOTON, BOTON_SUAVE, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { cerrarTurno, iniciarTurno, pausarTurno, reanudarTurno } from './actions'

export type Equipo = { id: string; code: string; tipo: string; alcance: number; libre: boolean }

export type Turno = {
  equipo: string | null
  tipo: string | null
  alcance: number
  desde: string
  pausado: boolean
  motivo: string | null
}

/**
 * Entrar a trabajo y marcarse no disponible.
 *
 * No hay turnos con hora de entrada: lo que esto registra es quién está ahora mismo para
 * recibir tarea. Y no se escoge el lado de la operación —eso lo reparte el jefe de bodega
 * por andén—, sólo el equipo, porque el equipo es lo que define hasta qué nivel del rack
 * llegan las tareas.
 *
 * La pausa existe para cuando le hablan a alguien para otra cosa: sale de la cola sin
 * perder el equipo que tiene asignado.
 */
export function TurnoForm({ turno, equipos }: { turno: Turno | null; equipos: Equipo[] }) {
  const [estado, accion, pending] = useActionState(iniciarTurno, null)

  if (turno) {
    const hora = new Date(turno.desde).toLocaleTimeString('es-HN', {
      hour: '2-digit',
      minute: '2-digit',
    })

    return (
      <div className="flex flex-col gap-4 rounded-2xl border border-borde p-4">
        {turno.pausado ? (
          <p className="rounded-xl bg-celeste/15 p-3">
            No disponible{turno.motivo ? `: ${turno.motivo}` : ''}. No te van a caer tareas.
          </p>
        ) : (
          <Logro>Estás disponible desde las {hora}.</Logro>
        )}

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
        </dl>

        {turno.pausado ? (
          <form action={reanudarTurno}>
            <button type="submit" className={BOTON}>
              Ya estoy disponible
            </button>
          </form>
        ) : (
          <form action={pausarTurno} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className={ETIQUETA}>¿Por qué? (opcional)</span>
              <input name="motivo" placeholder="Me llamaron de la oficina" className={CAMPO} />
            </label>
            <button type="submit" className={BOTON_SUAVE}>
              No estoy disponible
            </button>
          </form>
        )}

        <form action={cerrarTurno}>
          <button type="submit" className={BOTON_SUAVE}>
            Salir
          </button>
        </form>
      </div>
    )
  }

  const disponibles = equipos.filter((e) => e.libre)

  return (
    <form action={accion} className="flex flex-col gap-4 rounded-2xl border border-borde p-4">
      <p className="text-sm text-azul/70">
        Mientras no entres a trabajo no te caen tareas. El equipo define hasta qué nivel del
        rack te llegan.
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

      <button type="submit" disabled={pending} className={BOTON}>
        {pending ? 'Entrando...' : 'Entrar a trabajo'}
      </button>

      {estado && !estado.ok ? <Aviso>{estado.error}</Aviso> : null}
    </form>
  )
}
