'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/auth/session'
import { SetPasswordSchema } from '@/lib/schemas/password'

export type SetPasswordState = { error: string | null }

export async function setPassword(
  _prev: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  await requireUser()

  const parsed = SetPasswordSchema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })

  if (error) {
    return { error: 'No se pudo guardar la contraseña. Intenta de nuevo.' }
  }

  redirect('/')
}
