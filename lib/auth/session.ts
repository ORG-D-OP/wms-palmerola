import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ForbiddenError } from '@/lib/errors'
import { can, rolDe, type Permission, type UserRole } from '@/lib/auth/roles'

export type SessionUser = {
  id: string
  email: string | null
  fullName: string
  /** El rango: lo que el jefe le puso. No cambia por ponerse a trabajar en otra cosa. */
  role: UserRole
  /** El rango más lo concedido para cubrir. De aquí salen los permisos. */
  roles: UserRole[]
  /**
   * Con qué está trabajando **hoy**, que no es lo mismo que su rango: el chequeador de rango
   * que baja a ayudar entra a trabajar de auxiliar y le caen viajes; el que está de chequeador
   * no se mueve del andén. Sin turno abierto, su rango.
   */
  workingRole: UserRole
  /**
   * Si anda con algo en la mano. Hace falta porque el rol del turno esconde las pantallas de
   * viaje, y a quien se cambió a chequeador con una tarea empezada eso lo dejaría encerrado:
   * la base se la sigue dando —`claim_next_task` devuelve lo propio antes de filtrar— pero
   * sin la pantalla no tiene por dónde terminarla, y `trabajar_como` no lo deja cambiar de
   * rol con algo empezado.
   */
  tareasEnMano: boolean
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
    .select('full_name, role, roles_extra, is_active')
    .eq('id', user.id)
    .single()

  // Un usuario desactivado tiene sesion valida pero no entra.
  if (!profile?.is_active) return null

  const rango = rolDe(profile.role)
  const concedidos = (profile.roles_extra ?? []).map(rolDe)

  const [{ data: turno }, { count: enMano }] = await Promise.all([
    supabase
      .from('shift_assignment')
      .select('working_role')
      .eq('profile_id', user.id)
      .is('ended_at', null)
      .maybeSingle(),
    supabase
      .from('task')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', user.id)
      .in('status', ['ASSIGNED', 'IN_PROGRESS']),
  ])

  return {
    id: user.id,
    email: user.email ?? null,
    fullName: profile.full_name,
    role: rango,
    roles: [...new Set([rango, ...concedidos])],
    workingRole: turno?.working_role ? rolDe(turno.working_role) : rango,
    tareasEnMano: (enMano ?? 0) > 0,
  }
})

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  return user
}

export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser()
  if (!can(user.roles, permission)) throw new ForbiddenError()
  return user
}
