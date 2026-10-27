import { z } from 'zod'

// Debe coincidir con la politica configurada en Supabase, para dar un mensaje util
// en vez del error generico del servidor de autenticacion.
export const MIN_LENGTH = 12

export const PasswordSchema = z
  .string()
  .min(MIN_LENGTH, `Debe tener al menos ${MIN_LENGTH} caracteres`)
  .max(128)
  .regex(/[a-z]/, 'Debe incluir una minúscula')
  .regex(/[A-Z]/, 'Debe incluir una mayúscula')
  .regex(/[0-9]/, 'Debe incluir un número')

export const SetPasswordSchema = z
  .object({
    password: PasswordSchema,
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    path: ['confirm'],
    message: 'Las contraseñas no coinciden',
  })
