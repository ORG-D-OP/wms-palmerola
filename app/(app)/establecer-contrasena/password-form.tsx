'use client'

import { useActionState } from 'react'
import { MIN_LENGTH } from '@/lib/schemas/password'
import { setPassword, type SetPasswordState } from './actions'

const INITIAL: SetPasswordState = { error: null }

export function PasswordForm() {
  const [state, formAction, pending] = useActionState(setPassword, INITIAL)

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Contrasena nueva</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_LENGTH}
          className="h-12 rounded-lg border border-black/15 px-3 text-base dark:border-white/20"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Repitela</span>
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          className="h-12 rounded-lg border border-black/15 px-3 text-base dark:border-white/20"
        />
      </label>

      <p className="text-xs opacity-70">
        Al menos {MIN_LENGTH} caracteres, con una mayuscula, una minuscula y un numero.
      </p>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="h-12 rounded-lg bg-foreground font-medium text-background disabled:opacity-60"
      >
        {pending ? 'Guardando...' : 'Guardar'}
      </button>
    </form>
  )
}
