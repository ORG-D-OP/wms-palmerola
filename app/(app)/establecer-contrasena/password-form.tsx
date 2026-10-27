'use client'

import { useActionState } from 'react'
import { MIN_LENGTH } from '@/lib/schemas/password'
import { Aviso } from '@/components/ui/feedback'
import { BOTON, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { setPassword, type SetPasswordState } from './actions'

const INITIAL: SetPasswordState = { error: null }

export function PasswordForm() {
  const [state, formAction, pending] = useActionState(setPassword, INITIAL)

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className={ETIQUETA}>Contraseña nueva</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_LENGTH}
          className={CAMPO}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={ETIQUETA}>Repítela</span>
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          className={CAMPO}
        />
      </label>

      <p className="text-xs text-azul/60">
        Al menos {MIN_LENGTH} caracteres, con una mayúscula, una minúscula y un número.
      </p>

      {state.error ? <Aviso>{state.error}</Aviso> : null}

      <button
        type="submit"
        disabled={pending}
        className={BOTON}
      >
        {pending ? 'Guardando...' : 'Guardar'}
      </button>
    </form>
  )
}
