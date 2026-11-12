import type { Database } from '@/lib/database.types'

type RolEnLaBase = Database['public']['Enums']['user_role']

/**
 * Los roles son los de la bodega, no los que se supusieron: 25 auxiliares, 9 chequeadores
 * y 5 montacarguistas, más la supervisión (correo de Francisco, noviembre 2026). Quien sólo
 * mira la operación entra como solo lectura.
 *
 * El enum de la base trae además `inventarios`, inventado antes de preguntar. Borrarlo de
 * verdad no se puede: el tipo está en la firma de `has_role`, y de esa función cuelgan todas
 * las políticas de RLS, así que recrear el tipo se las llevaría por delante. Se queda ahí
 * muerto, sin etiqueta y sin permisos: la aplicación no lo puede asignar ni mostrar.
 */
export const ROLE_LABELS = {
  auxiliar: 'Auxiliar',
  chequeador: 'Chequeador',
  montacargista: 'Montacarguista',
  supervisor: 'Supervisor',
  admin: 'Administrador',
  solo_lectura: 'Solo lectura',
} as const satisfies Partial<Record<RolEnLaBase, string>>

export type UserRole = keyof typeof ROLE_LABELS

export const ROLES = Object.keys(ROLE_LABELS) as UserRole[]

/** Lo que traiga la base y no sea un rol de la bodega no ve nada. */
export function rolDe(valor: string | null | undefined): UserRole {
  return valor && valor in ROLE_LABELS ? (valor as UserRole) : 'solo_lectura'
}

/** Cuántos hay de cada rol. De aquí sale el dimensionamiento de equipos y turnos. */
export const PLANTILLA: Partial<Record<UserRole, number>> = {
  auxiliar: 25,
  chequeador: 9,
  montacargista: 5,
}

/** Permisos en un solo lugar, como datos. Lo que no esta aqui, no existe. */
const PERMISSIONS = {
  'inventario:ver': ROLES,
  'inventario:mover': ['auxiliar', 'chequeador', 'montacargista', 'supervisor', 'admin'],
  'inventario:ajustar': ['supervisor', 'admin'],
  'surtido:ejecutar': ['auxiliar', 'montacargista', 'supervisor', 'admin'],
  'conteo:ejecutar': ['chequeador', 'supervisor', 'admin'],
  'turno:iniciar': ['auxiliar', 'chequeador', 'montacargista', 'supervisor', 'admin'],
  'ingresos:administrar': ['chequeador', 'supervisor', 'admin'],
  'despachos:administrar': ['chequeador', 'supervisor', 'admin'],
  'areas:administrar': ['supervisor', 'admin'],
  'flota:administrar': ['supervisor', 'admin'],
  'tareas:reasignar': ['supervisor', 'admin'],
  'kpi:ver': ['supervisor', 'admin', 'solo_lectura'],
  'personal:administrar': ['supervisor', 'admin'],
  'maestros:editar': ['admin'],
  'usuarios:administrar': ['admin'],
} satisfies Record<string, readonly UserRole[]>

export type Permission = keyof typeof PERMISSIONS

/**
 * Los permisos son la unión de los roles de la persona: su rango más lo que el jefe le
 * concedió para cubrir. Cubrir no le quita nada de lo suyo, y bajar a ayudar tampoco: el rol
 * con el que se trabaja vive en el turno, no aquí.
 */
export function can(roles: UserRole | readonly UserRole[], permission: Permission): boolean {
  const permitidos = PERMISSIONS[permission] as readonly UserRole[]
  const mios = typeof roles === 'string' ? [roles] : roles
  return mios.some((r) => permitidos.includes(r))
}

/** Los roles con los que alguien se puede poner a trabajar, para el selector del turno. */
export const ROLES_DE_TRABAJO = ['auxiliar', 'chequeador', 'montacargista'] as const satisfies
  readonly UserRole[]

export function rolesDeTrabajoDe(roles: readonly UserRole[]): UserRole[] {
  if (roles.includes('supervisor') || roles.includes('admin')) return [...ROLES_DE_TRABAJO]
  return ROLES_DE_TRABAJO.filter((r) => roles.includes(r))
}
