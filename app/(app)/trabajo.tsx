'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { Aviso } from '@/components/ui/feedback'
import { BOTON, BOTON_SUAVE } from '@/components/ui/campos'
import { entrarATrabajo, reanudarTurno } from './turno/actions'

export type Trabajo = { equipo: string | null; pausado: boolean; motivo: string | null }

/**
 * Lo primero que ve una persona al entrar: el botón que dice que está disponible.
 *
 * No hay turnos con hora de entrada. Lo único que el sistema necesita saber es quién está
 * ahora mismo para recibir tarea, y sin eso la cola no reparte. El botón entra sin equipo,
 * que es el caso de casi todos; quien anda con montacargas entra desde Disponibilidad,
 * porque el equipo es lo que define hasta qué nivel del rack le llegan tareas.
 */
export function Trabajo({ trabajo }: { trabajo: Trabajo | null }) {
  const [estado, entrar, pending] = useActionState(entrarATrabajo, null)

  if (trabajo?.pausado) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl bg-celeste/15 p-4">
        <p>
          Estás marcado como no disponible{trabajo.motivo ? `: ${trabajo.motivo}` : ''}. No te
          van a caer tareas.
        </p>
        <form action={reanudarTurno}>
          <button type="submit" className={BOTON}>
            Ya estoy disponible
          </button>
        </form>
      </div>
    )
  }

  if (trabajo) return null

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-azul-08 p-4">
      <p>Para que te toquen tareas, entra a trabajo.</p>
      <form action={entrar}>
        <button type="submit" disabled={pending} className={BOTON}>
          {pending ? 'Entrando...' : 'Entrar a trabajo'}
        </button>
      </form>
      <Link href="/turno" className={BOTON_SUAVE}>
        Voy con montacargas
      </Link>
      {estado && !estado.ok ? <Aviso>{estado.error}</Aviso> : null}
    </div>
  )
}
