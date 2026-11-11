import { z } from 'zod'

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
})

const serverSchema = publicSchema.extend({
  ALLOWED_ORIGINS: z
    .string()
    .min(1)
    .transform((value) => value.split(',').map((origin) => origin.trim())),
})

/** Variables visibles en el navegador. Nada sensible puede vivir aqui. */
export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
})

/** Solo servidor. Importar esto desde un Client Component rompe el build a proposito. */
export function serverEnv() {
  return serverSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
  })
}

/**
 * La llave secreta va aparte, y no dentro de `serverEnv`, a proposito.
 *
 * `serverEnv()` lo llama el proxy en cada peticion. Si la llave fuera obligatoria ahi y
 * faltara en el despliegue, no se caeria el registro: se caeria el sitio entero. Aqui lo
 * unico que se rompe es la pantalla que de verdad la necesita.
 */
const adminSchema = z.object({ SUPABASE_SECRET_KEY: z.string().min(1) })

export function adminEnv() {
  return adminSchema.parse({ SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY })
}
