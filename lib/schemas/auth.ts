import { z } from 'zod'

export const LoginSchema = z.object({
  email: z.email('Correo invalido').max(160),
  password: z.string().min(1, 'Escribe tu contrasena').max(128),
})

export type LoginInput = z.infer<typeof LoginSchema>
