import type { Database } from '@/lib/database.types'

export type UserRole = Database['public']['Enums']['user_role']

/**
 * Los roles son los de la bodega, no los que se suponían: 25 auxiliares, 9 chequeadores
 * y 5 montacarguistas, más la supervisión (correo de Francisco, noviembre 2026).
 */
export const ROLE_LABELS: Record<UserRole, string> = {
  auxiliar: 'Auxiliar',
  chequeador: 'Chequeador',
  montacargista: 'Montacarguista',
  supervisor: 'Supervisor',
  inventarios: 'Inventarios',
  admin: 'Administrador',
  solo_lectura: 'Solo lectura',
}

export const ROLES = Object.keys(ROLE_LABELS) as UserRole[]

/** Cuántos hay de cada rol. De aquí sale el dimensionamiento de equipos y turnos. */
export const PLANTILLA: Partial<Record<UserRole, number>> = {
  auxiliar: 25,
  chequeador: 9,
  montacargista: 5,
}

/** Permisos en un solo lugar, como datos. Lo que no esta aqui, no existe. */
const PERMISSIONS = {
  'inventario:ver': ROLES,
  'inventario:mover': [
    'auxiliar',
    'chequeador',
    'montacargista',
    'supervisor',
    'inventarios',
    'admin',
  ],
  'inventario:ajustar': ['inventarios', 'supervisor', 'admin'],
  'surtido:ejecutar': ['auxiliar', 'montacargista', 'supervisor', 'admin'],
  'conteo:ejecutar': ['chequeador', 'inventarios', 'supervisor', 'admin'],
  'turno:iniciar': ['auxiliar', 'chequeador', 'montacargista', 'supervisor', 'admin'],
  'ingresos:administrar': ['chequeador', 'supervisor', 'admin'],
  'despachos:administrar': ['chequeador', 'supervisor', 'admin'],
  'pedidos:administrar': ['supervisor', 'admin'],
  'areas:administrar': ['supervisor', 'admin'],
  'flota:administrar': ['supervisor', 'admin'],
  'tareas:reasignar': ['supervisor', 'admin'],
  'kpi:ver': ['supervisor', 'admin', 'solo_lectura'],
  'maestros:editar': ['admin'],
  'usuarios:administrar': ['admin'],
} satisfies Record<string, readonly UserRole[]>

export type Permission = keyof typeof PERMISSIONS

export function can(role: UserRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly UserRole[]).includes(role)
}
