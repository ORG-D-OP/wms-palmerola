'use client'

import { useActionState, useState, useTransition } from 'react'
import { Aviso, Logro } from '@/components/ui/feedback'
import { BOTON, BOTON_SUAVE, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { ROLE_LABELS, esDeTrabajo, type UserRole } from '@/lib/auth/roles'
import { hora } from '@/lib/warehouse/hora'
import {
  cambiarEquipo,
  cerrarTurno,
  iniciarTurno,
  pausarTurno,
  reanudarTurno,
  trabajarComo,
} from './actions'

/**
 * Los tipos de equipo: lo que se declara al entrar, porque de ahí sale la franja de niveles
 * que le toca. No es sólo un techo: el de rack no baja al piso, porque son tareas distintas.
 */
export type Tipo = { code: string; name: string; min: number; alcance: number }

/**
 * Lo que le toca a un equipo, dicho como se dice en la bodega.
 *
 * Antes era un «Hasta el nivel 6» que no respondía a la pregunta que la gente hace, que es si
 * anda con el de piso o con el de rack. Sale de los dos números, no de una lista a mano.
 */
const franja = ({ min, alcance }: { min: number; alcance: number }) =>
  alcance === 0
    ? 'sólo piso'
    : min === 0
      ? `piso y rack, hasta el nivel ${alcance}`
      : `sólo rack, niveles ${min} a ${alcance}`

export type Turno = {
  equipo: string | null
  tipo: string | null
  min: number
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
            <dd className="text-lg">{turno.tipo ?? 'A pie o con burro'}</dd>
          </div>
          <div>
            <dt className={ETIQUETA}>Le toca</dt>
            <dd className="text-lg first-letter:uppercase">{franja(turno)}</dd>
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

        <CambiarEquipo actual={turno.equipo} tipos={tipos} rol={turno.rol} />

        <CambiarRol actual={turno.rol} rango={rango} roles={roles} tipos={tipos} />

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
        Mientras no entres a trabajo no te caen tareas. El equipo decide cuáles: el de piso va
        al piso y el de rack va al rack, porque son tareas distintas.
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
          <option value="">A pie o con burro · sólo piso</option>
          {tipos.map((t) => (
            <option key={t.code} value={t.code}>
              {t.name} · {franja(t)}
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
 * Cambiar de máquina sin salir del turno.
 *
 * Es lo que pasa cuando no llegó el de rack: el supervisor le cambia de puesto a alguien y le
 * da el montacargas especial. Antes el equipo era de sólo lectura aquí, así que la única
 * manera era salir de trabajo y volver a entrar, y en el camino se perdía el andén y el rol
 * con el que andaba. Y quien ya es montacarguista no puede quedarse sin máquina: si va a pie,
 * lo que cambia es el rol, no el equipo.
 */
function CambiarEquipo({
  actual,
  tipos,
  rol,
}: {
  actual: string | null
  tipos: Tipo[]
  rol: UserRole
}) {
  const otros = tipos.filter((t) => t.code !== actual)
  const aPie = actual !== null && rol !== 'montacargista'
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (otros.length === 0 && !aPie) return null

  const cambiar = (code?: string) =>
    startTransition(async () => {
      const res = await cambiarEquipo(code)
      setError(res.ok ? null : res.error)
    })

  return (
    <div className="flex flex-col gap-2 border-t border-borde pt-4">
      <span className={ETIQUETA}>Cambiar de equipo</span>
      <div className="flex flex-wrap gap-2">
        {otros.map((t) => (
          <button
            key={t.code}
            type="button"
            disabled={pending}
            className={BOTON_SUAVE}
            onClick={() => cambiar(t.code)}
          >
            {t.name}
          </button>
        ))}
        {aPie ? (
          <button
            type="button"
            disabled={pending}
            className={BOTON_SUAVE}
            onClick={() => cambiar()}
          >
            Dejar el equipo
          </button>
        ) : null}
      </div>
      {error ? <Aviso>{error}</Aviso> : null}
    </div>
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
  tipos,
}: {
  actual: UserRole
  rango: UserRole
  roles: UserRole[]
  tipos: Tipo[]
}) {
  const otros = roles.filter((r) => r !== actual)
  const ayudar = otros.filter(esDeTrabajo)
  // De montacarguista no se trabaja «en general»: el botón ya trae la máquina, porque el de
  // piso y el de rack no hacen las mismas tareas. Un toque escoge las dos cosas.
  const oficios = ayudar.filter((r) => r !== 'montacargista')
  const conMaquina = ayudar.includes('montacargista')
  const volver = otros.includes(rango) && !esDeTrabajo(rango) ? rango : null
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (otros.length === 0) return null

  const cambiar = (r: UserRole, tipo?: string) =>
    startTransition(async () => {
      const res = await trabajarComo(r, tipo)
      setError(res.ok ? null : res.error)
    })

  return (
    <div className="flex flex-col gap-2 border-t border-borde pt-4">
      {ayudar.length > 0 ? (
        <>
          <span className={ETIQUETA}>Ayudar con otro trabajo</span>
          {oficios.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {oficios.map((r) => (
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
          ) : null}
          {conMaquina ? (
            <>
              <span className="text-sm text-azul/70">
                De montacarguista, ¿con qué máquina?
              </span>
              <div className="flex flex-wrap gap-2">
                {tipos.map((t) => (
                  <button
                    key={t.code}
                    type="button"
                    disabled={pending}
                    className={BOTON_SUAVE}
                    onClick={() => cambiar('montacargista', t.code)}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </>
          ) : null}
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
