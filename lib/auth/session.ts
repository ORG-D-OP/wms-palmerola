import 'server-only'
import { cache } from 'react'
import { forbidden, redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
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
  /**
   * El andén en el que está parada hoy. Decide qué tareas le caen —`claim_next_task` sólo le
   * da las que salen o entran por ahí— y qué camión retoma al volver a Ingreso o a Despacho,
   * así que va escrito arriba, donde se ve sin preguntar.
   */
  anden: string | null
  /**
   * Con qué máquina anda hoy. Desde que el reparto es por clase —el de piso sólo a piso, el
   * de rack sólo a rack— esto decide qué tareas le caen, así que va arriba, al lado del
   * andén: quien no ve una tarea en toda la mañana tiene que poder saber si es que no hay o
   * es que no le toca. Nulo mientras no haya turno abierto, o si entró a pie.
   */
  equipo: string | null
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
      .select('working_role, dock_door(code), equipment_type(name)')
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
    anden: turno?.dock_door?.code ?? null,
    equipo: turno?.equipment_type?.name ?? null,
  }
})

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  return user
}

/**
 * `forbidden()` y no una excepción: una excepción acaba en `error.tsx`, que contestaba **500**
 * con «Algo se cayó», un botón de volver a intentar que no iba a funcionar nunca y un número
 * de diez cifras para molestar al jefe de bodega. No se había caído nada: era que no le toca.
 * Ahora es un **403** de verdad y una pantalla que lo dice.
 */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser()
  if (!can(user.roles, permission)) forbidden()
  return user
}

/**
 * Las pantallas que mandan a caminar por la bodega: guardar, surtir, reordenar y contar.
 *
 * El chequeador no sale del andén —verifica lo que entra y lo que sale, y meter o sacar
 * producto les toca a los auxiliares y a los montacarguistas—, así que estas pantallas no son
 * suyas mientras trabaje de eso. Esconder el enlace no basta: escribiendo la dirección a mano
 * se abrían igual.
 *
 * Quien trae algo en la mano pasa: una tarea empezada es suya hasta que la cierre, y
 * `trabajar_como` no deja cambiar de rol con algo empezado.
 */
export async function requireDeBodega(permission: Permission): Promise<SessionUser> {
  const user = await requirePermission(permission)
  if (user.workingRole === 'chequeador' && !user.tareasEnMano) forbidden()
  return user
}
