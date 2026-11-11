'use client'

import { useState, useTransition } from 'react'
import { Aviso } from '@/components/ui/feedback'
import { BOTON, BOTON_SUAVE, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { ROLES, ROLE_LABELS, type UserRole } from '@/lib/auth/roles'
import {
  aceptar,
  autorizarCorreos,
  devolver,
  ponerRol,
  quitarCorreo,
  rechazar,
  sacar,
} from './actions'

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

export type Correo = {
  email: string
  nota: string | null
  created_at: string
  ya_registrado: boolean
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
  correos,
}: {
  pendientes: Persona[]
  dentro: Persona[]
  fuera: Persona[]
  correos: Correo[]
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

      <Correos lista={correos} onError={setError} />
    </div>
  )
}

/**
 * La puerta del registro. Sólo quien está aquí puede crear cuenta, y estar aquí no es estar
 * dentro: la cuenta igual nace apagada esperando que alguien la acepte arriba.
 */
function Correos({
  lista,
  onError,
}: {
  lista: Correo[]
  onError: (e: string | null) => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [pending, empezar] = useTransition()

  const sinUsar = lista.filter((c) => !c.ya_registrado)

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-borde p-4">
      <div>
        <h2 className="text-lg">Correos con permiso de registrarse ({lista.length})</h2>
        <p className="text-sm text-azul/60">
          Da de alta el correo de cada persona, sea de Dinant o personal. Quien no esté aquí no
          puede crear cuenta.
        </p>
      </div>

      {abierto ? (
        <form
          action={(datos) => {
            onError(null)
            empezar(async () => {
              const res = await autorizarCorreos(
                String(datos.get('correos') ?? ''),
                String(datos.get('nota') ?? ''),
              )
              if (!res.ok) onError(res.error)
              else setAbierto(false)
            })
          }}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1.5">
            <span className={ETIQUETA}>Correos</span>
            <textarea
              name="correos"
              rows={5}
              autoFocus
              required
              placeholder="uno@dinant.com, otro@gmail.com"
              className={CAMPO}
            />
            <span className="text-sm text-azul/60">
              Pega los que quieras: uno por línea o separados por comas.
            </span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={ETIQUETA}>Nota, si te sirve</span>
            <input name="nota" placeholder="Cuadrilla de la noche" className={CAMPO} />
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="submit" disabled={pending} className={BOTON}>
              {pending ? 'Dando de alta...' : 'Dar de alta'}
            </button>
            <button type="button" onClick={() => setAbierto(false)} className={BOTON_SUAVE}>
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setAbierto(true)} className={BOTON_SUAVE}>
          Dar de alta correos
        </button>
      )}

      {sinUsar.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className={ETIQUETA}>Todavía no se han registrado ({sinUsar.length})</p>
          <ul className="flex flex-col divide-y divide-borde">
            {sinUsar.map((c) => (
              <li key={c.email} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {c.email}
                  {c.nota ? <span className="text-azul/60"> · {c.nota}</span> : null}
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    onError(null)
                    empezar(async () => {
                      const res = await quitarCorreo(c.email)
                      if (!res.ok) onError(res.error)
                    })
                  }}
                  className="text-sm underline underline-offset-4"
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
