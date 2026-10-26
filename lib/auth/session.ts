import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ForbiddenError } from '@/lib/errors'
import { can, type Permission, type UserRole } from '@/lib/auth/roles'

export type SessionUser = {
  id: string
  email: string | null
  fullName: string
  role: UserRole
}

/** cache() evita repetir la consulta cuando varios componentes del mismo render la piden. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profile')
    .select('full_name, role, is_active')
    .eq('id', user.id)
    .single()

  // Un usuario desactivado tiene sesion valida pero no entra.
  if (!profile?.is_active) return null

  return {
    id: user.id,
    email: user.email ?? null,
    fullName: profile.full_name,
    role: profile.role,
  }
})

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  return user
}

export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser()
  if (!can(user.role, permission)) throw new ForbiddenError()
  return user
}
