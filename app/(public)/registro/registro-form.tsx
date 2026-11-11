'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { Aviso } from '@/components/ui/feedback'
import { BOTON, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { registrarse, type RegistroState } from './actions'

const INITIAL: RegistroState = { error: null, listo: false }

export function RegistroForm() {
  const [state, formAction, pending] = useActionState(registrarse, INITIAL)

  if (state.listo) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-xl">Listo, tu cuenta ya existe</h2>
        <p className="text-azul/70">
          Falta que el jefe de bodega te acepte y te diga qué vas a hacer. Mientras tanto puedes
          entrar, pero no vas a ver tareas.
        </p>
        <Link href="/login" className={BOTON}>
          Ir a entrar
        </Link>
      </div>
    )
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className={ETIQUETA}>Nombre completo</span>
        <input name="nombre" autoComplete="name" required className={CAMPO} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={ETIQUETA}>Número de identidad</span>
        <input name="identidad" inputMode="numeric" required className={CAMPO} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={ETIQUETA}>Correo</span>
        <input name="email" type="email" autoComplete="username" required className={CAMPO} />
        <span className="text-sm text-azul/60">
          El que le diste al jefe de bodega. Si no está dado de alta no vas a poder registrarte.
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={ETIQUETA}>Contraseña</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          className={CAMPO}
        />
        <span className="text-sm text-azul/60">
          Al menos 12 caracteres, con mayúscula, minúscula y número.
        </span>
      </label>

      {state.error ? <Aviso>{state.error}</Aviso> : null}

      <button type="submit" disabled={pending} className={BOTON}>
        {pending ? 'Creando...' : 'Crear mi cuenta'}
      </button>

      <Link href="/login" className="text-center text-sm underline underline-offset-4">
        Ya tengo cuenta
      </Link>
    </form>
  )
}
