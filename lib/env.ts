import { z } from 'zod'

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  /**
   * De dónde cuelga la impresora de etiquetas, como origen: `http://10.0.0.5`.
   *
   * Va en configuración y no en el repositorio, que es público, ni en la base: el mismo valor
   * tiene que alimentar a la vez el envío del navegador y la política de seguridad del sitio,
   * y si vive en dos sitios acaban diciendo cosas distintas. Vacío significa que la bodega
   * todavía no tiene impresora, y entonces las etiquetas se encolan pero no se entregan.
   */
  NEXT_PUBLIC_IMPRESORA_ORIGEN: z
    .union([z.url({ protocol: /^https?$/ }), z.literal('')])
    .default(''),
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
  NEXT_PUBLIC_IMPRESORA_ORIGEN: process.env.NEXT_PUBLIC_IMPRESORA_ORIGEN,
})

/** Solo servidor. Importar esto desde un Client Component rompe el build a proposito. */
export function serverEnv() {
  return serverSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_IMPRESORA_ORIGEN: process.env.NEXT_PUBLIC_IMPRESORA_ORIGEN,
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
