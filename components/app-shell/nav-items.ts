import { can, type UserRole } from '@/lib/auth/roles'

const TODOS = [
  { href: '/', label: 'Tablero', icon: 'dashboard', permiso: null },
  { href: '/recibo', label: 'Recibo', icon: 'move_to_inbox', permiso: 'inventario:mover' },
  { href: '/guardar', label: 'Guardar', icon: 'shelves', permiso: 'inventario:mover' },
  { href: '/productos', label: 'Productos', icon: 'inventory_2', permiso: null },
] as const

export type NavItem = { href: string; label: string; icon: string }

export function navParaRol(role: UserRole): NavItem[] {
  return TODOS.filter((i) => i.permiso === null || can(role, i.permiso)).map(
    ({ href, label, icon }) => ({ href, label, icon }),
  )
}
