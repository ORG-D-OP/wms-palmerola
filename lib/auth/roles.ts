import type { Database } from '@/lib/database.types'

export type UserRole = Database['public']['Enums']['user_role']

export const ROLE_LABELS: Record<UserRole, string> = {
  operador_recibo: 'Operador de recibo',
  operador_picking: 'Operador de surtido',
  montacargista: 'Montacarguista',
  supervisor: 'Supervisor',
  inventarios: 'Inventarios',
  admin: 'Administrador',
  solo_lectura: 'Solo lectura',
}

export const ROLES = Object.keys(ROLE_LABELS) as UserRole[]

/** Permisos en un solo lugar, como datos. Lo que no esta aqui, no existe. */
const PERMISSIONS = {
  'inventario:ver': ROLES,
  'inventario:mover': ['operador_recibo', 'montacargista', 'supervisor', 'inventarios', 'admin'],
  'inventario:ajustar': ['inventarios', 'supervisor', 'admin'],
  'surtido:ejecutar': ['operador_picking', 'montacargista', 'supervisor', 'admin'],
  'tareas:reasignar': ['supervisor', 'admin'],
  'kpi:ver': ['supervisor', 'admin', 'solo_lectura'],
  'maestros:editar': ['admin'],
  'usuarios:administrar': ['admin'],
} satisfies Record<string, readonly UserRole[]>

export type Permission = keyof typeof PERMISSIONS

export function can(role: UserRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly UserRole[]).includes(role)
}
