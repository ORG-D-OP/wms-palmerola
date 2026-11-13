'use client'

import { useActionState, useState, useTransition } from 'react'
import { Aviso, Logro } from '@/components/ui/feedback'
import { BOTON, BOTON_SUAVE, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { ROLE_LABELS, esDeTrabajo, type UserRole } from '@/lib/auth/roles'
import { hora } from '@/lib/warehouse/hora'
import { cerrarTurno, iniciarTurno, pausarTurno, reanudarTurno, trabajarComo } from './actions'

export type Equipo = { id: string; code: string; tipo: string; alcance: number; libre: boolean }

/** Los tipos de equipo: lo que se declara al entrar, porque de ahí sale el alcance. */
export type Tipo = { code: string; name: string; alcance: number }

export type Turno = {
  equipo: string | null
  tipo: string | null
  alcance: number
  desde: string
  pausado: boolean
  motivo: string | null
  anden: string | null
  rol: UserRole
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
export function TurnoForm({
  turno,
  tipos,
  rango,
  roles,
}: {
  turno: Turno | null
  tipos: Tipo[]
  rango: UserRole
  roles: UserRole[]
}) {
  const [estado, accion, pending] = useActionState(iniciarTurno, null)

  if (turno) {
    return (
      <div className="flex flex-col gap-4 rounded-2xl border border-borde p-4">
        {turno.pausado ? (
          <p className="rounded-xl bg-celeste/15 p-3">
            No disponible{turno.motivo ? `: ${turno.motivo}` : ''}. No te van a caer tareas.
          </p>
        ) : (
          <Logro>Estás disponible desde las {hora(turno.desde)}.</Logro>
        )}

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className={ETIQUETA}>Trabajando como</dt>
            <dd className="text-lg">{ROLE_LABELS[turno.rol]}</dd>
          </div>
          <div>
            <dt className={ETIQUETA}>Equipo</dt>
            <dd className="text-lg">{turno.tipo ?? 'Sin equipo'}</dd>
          </div>
          <div>
            <dt className={ETIQUETA}>Alcance</dt>
            <dd className="text-lg">
              {turno.alcance === 0 ? 'Solo piso' : `Hasta el nivel ${turno.alcance}`}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className={ETIQUETA}>Andén</dt>
            <dd className="text-lg">{turno.anden ?? 'Toda la bodega'}</dd>
            <dd className="text-sm text-azul/60">
              {turno.anden
                ? 'Sólo te caen tareas de este andén. Lo cambia el jefe de bodega.'
                : 'Te cae trabajo de cualquier andén.'}
            </dd>
          </div>
        </dl>

        <CambiarRol actual={turno.rol} rango={rango} roles={roles} />

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
            Salir de trabajo
          </button>
        </form>
      </div>
    )
  }

  return (
    <form action={accion} className="flex flex-col gap-4 rounded-2xl border border-borde p-4">
      <p className="text-sm text-azul/70">
        Mientras no entres a trabajo no te caen tareas. El equipo define hasta qué nivel del
        rack te llegan.
      </p>

      {roles.length > 1 ? (
        <label className="flex flex-col gap-1.5">
          <span className={ETIQUETA}>¿Como qué vas a trabajar?</span>
          <select name="rol" defaultValue={roles[0]} className={CAMPO}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="flex flex-col gap-1.5">
        <span className={ETIQUETA}>¿Con qué vas a andar?</span>
        <select name="tipo" defaultValue="" className={CAMPO}>
          <option value="">A pie o con burro (solo piso)</option>
          {tipos.map((t) => (
            <option key={t.code} value={t.code}>
              {t.name}
              {t.alcance > 0 ? ` · hasta el nivel ${t.alcance}` : ''}
            </option>
          ))}
        </select>
      </label>

      <button type="submit" disabled={pending} className={BOTON}>
        {pending ? 'Entrando...' : 'Entrar a trabajo'}
      </button>

      {estado && !estado.ok ? <Aviso>{estado.error}</Aviso> : null}
    </form>
  )
}

/**
 * Cambiarse de rol sin salir del turno.
 *
 * Es para el supervisor que baja a ayudar cuando se acumula el trabajo, y para quien cubre a
 * un compañero de vacaciones. No cambia lo que la persona es —eso sólo lo mueve el jefe—,
 * cambia qué trabajo le da el sistema. Y lo que tenía asignado sin empezar vuelve a la cola,
 * porque ya no es trabajo suyo; si anda con algo en la mano, primero lo termina.
 */
function CambiarRol({
  actual,
  rango,
  roles,
}: {
  actual: UserRole
  rango: UserRole
  roles: UserRole[]
}) {
  const otros = roles.filter((r) => r !== actual)
  const ayudar = otros.filter(esDeTrabajo)
  const volver = otros.includes(rango) && !esDeTrabajo(rango) ? rango : null
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (otros.length === 0) return null

  const cambiar = (r: UserRole) =>
    startTransition(async () => {
      const res = await trabajarComo(r)
      setError(res.ok ? null : res.error)
    })

  return (
    <div className="flex flex-col gap-2 border-t border-borde pt-4">
      {ayudar.length > 0 ? (
        <>
          <span className={ETIQUETA}>Ayudar con otro trabajo</span>
          <div className="flex flex-wrap gap-2">
            {ayudar.map((r) => (
              <button
                key={r}
                type="button"
                disabled={pending}
                className={BOTON_SUAVE}
                onClick={() => cambiar(r)}
              >
                {ROLE_LABELS[r]}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {volver ? (
        <button
          type="button"
          disabled={pending}
          className={BOTON_SUAVE}
          onClick={() => cambiar(volver)}
        >
          Dejar de ayudar: volver a lo mío
        </button>
      ) : null}

      {error ? <Aviso>{error}</Aviso> : null}
    </div>
  )
}
