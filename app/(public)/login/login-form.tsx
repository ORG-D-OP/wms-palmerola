'use client'

import { useActionState } from 'react'
import { Aviso } from '@/components/ui/feedback'
import { BOTON, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { login, type LoginState } from './actions'

const INITIAL: LoginState = { error: null }

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, INITIAL)

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className={ETIQUETA}>Correo</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className={CAMPO}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={ETIQUETA}>Contrasena</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={CAMPO}
        />
      </label>

      {state.error ? <Aviso>{state.error}</Aviso> : null}

      <button
        type="submit"
        disabled={pending}
        className={BOTON}
      >
        {pending ? 'Entrando...' : 'Entrar'}
      </button>
    </form>
  )
}
