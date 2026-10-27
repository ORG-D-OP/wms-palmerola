'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { LoginSchema } from '@/lib/schemas/auth'

export type LoginState = { error: string | null }

// Mensaje unico: distinguir "no existe" de "contrasena incorrecta" regala una lista de usuarios.
const CREDENCIALES = 'Usuario o contraseña incorrectos.'

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) return { error: CREDENCIALES }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error || !data.user) return { error: CREDENCIALES }

  const { data: profile } = await supabase
    .from('profile')
    .select('is_active')
    .eq('id', data.user.id)
    .single()

  if (!profile?.is_active) {
    await supabase.auth.signOut()
    return { error: 'Tu usuario está desactivado. Habla con tu supervisor.' }
  }

  redirect('/')
}

export async function logout() {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  redirect('/login')
}
