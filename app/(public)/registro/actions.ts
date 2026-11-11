'use server'

import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export type RegistroState = { error: string | null; listo: boolean }

const RegistroSchema = z.object({
  nombre: z.string().trim().min(5, 'Escribe tu nombre completo.').max(120),
  identidad: z.string().trim().min(3, 'Escribe tu número de identidad.').max(30),
  email: z.email('Correo inválido.').max(160),
  password: z.string().min(12, 'La contraseña necesita al menos 12 caracteres.').max(128),
})

/**
 * Alta de una persona nueva.
 *
 * El alta pública de Supabase está apagada a propósito: si estuviera abierta, cualquiera
 * crearía cuentas llamando a la API y la lista de correos no serviría de nada. Por eso la
 * cuenta la crea el servidor, y sólo después de encontrar el correo en la lista.
 *
 * `email_confirm` va en true sin mandar ningún correo: confirmar un buzón no dice quién es la
 * persona, y quien lo sabe es el jefe de bodega. Sin su visto bueno la cuenta no ve nada.
 */
export async function registrarse(
  _prev: RegistroState,
  formData: FormData,
): Promise<RegistroState> {
  const parsed = RegistroSchema.safeParse({
    nombre: formData.get('nombre'),
    identidad: formData.get('identidad'),
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Revisa los datos.', listo: false }
  }

  const admin = createSupabaseAdminClient()
  const correo = parsed.data.email.trim().toLowerCase()

  const { data: permitido } = await admin
    .from('correo_autorizado')
    .select('email')
    .eq('email', correo)
    .maybeSingle()

  if (!permitido) {
    return {
      error: 'Ese correo no está dado de alta. Pídele al jefe de bodega que lo agregue.',
      listo: false,
    }
  }

  const { error } = await admin.auth.admin.createUser({
    email: correo,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.nombre, employee_code: parsed.data.identidad },
  })

  if (error) {
    const mensaje = error.message.toLowerCase()
    if (mensaje.includes('already')) {
      return { error: 'Ya hay una cuenta con ese correo.', listo: false }
    }
    if (mensaje.includes('employee_code')) {
      return { error: 'Ya hay una cuenta con ese número de identidad.', listo: false }
    }
    return { error: 'No se pudo crear la cuenta. Inténtalo de nuevo.', listo: false }
  }

  return { error: null, listo: true }
}
