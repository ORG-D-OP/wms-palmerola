'use client'

import { useState, useTransition } from 'react'
import { Aviso } from '@/components/ui/feedback'
import { BOTON, BOTON_SUAVE, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { ROLES, ROLE_LABELS, type UserRole } from '@/lib/auth/roles'
import { aceptar, devolver, ponerCodigo, ponerRol, rechazar, sacar } from './actions'

export type Persona = {
  id: string
  nombre: string
  identidad: string | null
  correo: string
  rol: UserRole
  activa: boolean
  aceptada: boolean
  registrada: string
}

const ASIGNABLES = ROLES.filter((r) => r !== 'solo_lectura')

function Ficha({ p, children }: { p: Persona; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-borde p-4">
      <div>
        <p>{p.nombre}</p>
        <p className="text-sm text-azul/60">{p.correo}</p>
        {p.identidad ? (
          <p className="text-sm tabular-nums text-azul/60">Identidad {p.identidad}</p>
        ) : null}
      </div>
      {children}
    </li>
  )
}

export function Lista({
  pendientes,
  dentro,
  fuera,
  codigo,
}: {
  pendientes: Persona[]
  dentro: Persona[]
  fuera: Persona[]
  codigo: string
}) {
  const [error, setError] = useState<string | null>(null)
  const [elegido, setElegido] = useState<Record<string, string>>({})
  const [pending, empezar] = useTransition()

  const hacer = (accion: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null)
    empezar(async () => {
      const res = await accion()
      if (!res.ok) setError(res.error ?? 'No se pudo hacer el cambio.')
    })
  }

  const rolDe = (p: Persona) => elegido[p.id] ?? (p.aceptada ? p.rol : '')

  return (
    <div className="flex flex-col gap-8">
      {error ? <Aviso>{error}</Aviso> : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg">Esperando ({pendientes.length})</h2>
        {pendientes.length === 0 ? (
          <p className="text-sm text-azul/60">Nadie esperando. Todo al día.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pendientes.map((p) => (
              <Ficha key={p.id} p={p}>
                <label className="flex flex-col gap-1.5">
                  <span className={ETIQUETA}>Qué va a hacer</span>
                  <select
                    value={rolDe(p)}
                    onChange={(e) => setElegido({ ...elegido, [p.id]: e.target.value })}
                    className={CAMPO}
                  >
                    <option value="">Elige un rol</option>
                    {ASIGNABLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    disabled={pending || !rolDe(p)}
                    onClick={() => hacer(() => aceptar(p.id, rolDe(p)))}
                    className={BOTON}
                  >
                    Aceptar
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => hacer(() => rechazar(p.id))}
                    className={BOTON_SUAVE}
                  >
                    No trabaja aquí
                  </button>
                </div>
              </Ficha>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg">En la bodega ({dentro.length})</h2>
        <ul className="flex flex-col gap-3">
          {dentro.map((p) => (
            <Ficha key={p.id} p={p}>
              <label className="flex flex-col gap-1.5">
                <span className={ETIQUETA}>Rol</span>
                <select
                  value={rolDe(p)}
                  onChange={(e) => {
                    setElegido({ ...elegido, [p.id]: e.target.value })
                    hacer(() => ponerRol(p.id, e.target.value))
                  }}
                  disabled={pending}
                  className={CAMPO}
                >
                  {ASIGNABLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={pending}
                onClick={() => hacer(() => sacar(p.id))}
                className={BOTON_SUAVE}
              >
                Dar de baja
              </button>
            </Ficha>
          ))}
        </ul>
      </section>

      {fuera.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg">Dados de baja ({fuera.length})</h2>
          <ul className="flex flex-col gap-3">
            {fuera.map((p) => (
              <Ficha key={p.id} p={p}>
                <p className="text-sm text-azul/60">Era {ROLE_LABELS[p.rol]}</p>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => hacer(() => devolver(p.id))}
                  className={BOTON_SUAVE}
                >
                  Volvió: reactivar
                </button>
              </Ficha>
            ))}
          </ul>
        </section>
      ) : null}

      <Codigo actual={codigo} onError={setError} />
    </div>
  )
}

function Codigo({
  actual,
  onError,
}: {
  actual: string
  onError: (e: string | null) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [pending, empezar] = useTransition()

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-borde p-4">
      <h2 className="text-lg">Código de bodega</h2>
      <p className="text-sm text-azul/60">
        Es lo que le das a alguien para que pueda crear su cuenta. Cámbialo cuando se corra la voz.
      </p>
      <p className="font-mono text-2xl tracking-widest">{actual}</p>

      {abierto ? (
        <form
          action={(datos) => {
            onError(null)
            empezar(async () => {
              const res = await ponerCodigo(String(datos.get('codigo') ?? ''))
              if (!res.ok) onError(res.error)
              else setAbierto(false)
            })
          }}
          className="flex flex-col gap-3"
        >
          <input
            name="codigo"
            autoFocus
            autoCapitalize="characters"
            minLength={6}
            required
            className={CAMPO}
          />
          <button type="submit" disabled={pending} className={BOTON}>
            {pending ? 'Guardando...' : 'Guardar el código nuevo'}
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setAbierto(true)} className={BOTON_SUAVE}>
          Cambiarlo
        </button>
      )}
    </section>
  )
}
