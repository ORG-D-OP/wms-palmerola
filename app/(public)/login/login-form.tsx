'use client'

import { useActionState } from 'react'
import { login, type LoginState } from './actions'

const INITIAL: LoginState = { error: null }

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, INITIAL)

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Correo</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="h-12 rounded-lg border border-black/15 px-3 text-base dark:border-white/20"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Contrasena</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-12 rounded-lg border border-black/15 px-3 text-base dark:border-white/20"
        />
      </label>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="h-12 rounded-lg bg-foreground text-background font-medium disabled:opacity-60"
      >
        {pending ? 'Entrando...' : 'Entrar'}
      </button>
    </form>
  )
}
