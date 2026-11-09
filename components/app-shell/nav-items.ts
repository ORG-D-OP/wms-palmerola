import { can, type Permission, type UserRole } from '@/lib/auth/roles'

/**
 * La barra inferior del teléfono no aguanta más de cinco; lo que sobra queda en el menú de
 * arriba y en el tablero. El orden es el del día: primero lo que se hace con las manos,
 * después lo que se consulta.
 */
const TODOS = [
  { href: '/', label: 'Tablero', icon: 'dashboard', permiso: null, movil: true },
  {
    href: '/ingreso',
    label: 'Ingreso',
    icon: 'local_shipping',
    permiso: 'inventario:mover',
    movil: true,
  },
  {
    href: '/despacho',
    label: 'Despacho',
    icon: 'outbound',
    permiso: 'inventario:mover',
    movil: true,
  },
  { href: '/guardar', label: 'Guardar', icon: 'shelves', permiso: 'inventario:mover', movil: true },
  {
    href: '/surtir',
    label: 'Surtir',
    icon: 'shopping_basket',
    permiso: 'surtido:ejecutar',
    movil: true,
  },
  { href: '/inventario', label: 'Buscar', icon: 'search', permiso: 'inventario:ver', movil: true },
  {
    href: '/turno',
    label: 'Disponibilidad',
    icon: 'badge',
    permiso: 'turno:iniciar',
    movil: false,
  },
  {
    href: '/carga-inicial',
    label: 'Carga inicial',
    icon: 'move_to_inbox',
    permiso: 'inventario:mover',
    movil: false,
  },
  {
    href: '/retornables',
    label: 'Retornables',
    icon: 'recycling',
    permiso: 'inventario:mover',
    movil: false,
  },
  {
    href: '/pedidos',
    label: 'Pedidos',
    icon: 'receipt_long',
    permiso: 'pedidos:administrar',
    movil: false,
  },
  { href: '/productos', label: 'Productos', icon: 'inventory_2', permiso: null, movil: false },
  {
    href: '/areas',
    label: 'Áreas',
    icon: 'dashboard_customize',
    permiso: 'areas:administrar',
    movil: false,
  },
] as const satisfies readonly {
  href: string
  label: string
  icon: string
  permiso: Permission | null
  movil: boolean
}[]

export type NavItem = { href: string; label: string; icon: string }

const permitido = (role: UserRole, permiso: Permission | null) =>
  permiso === null || can(role, permiso)

export function navParaRol(role: UserRole): NavItem[] {
  return TODOS.filter((i) => permitido(role, i.permiso)).map(({ href, label, icon }) => ({
    href,
    label,
    icon,
  }))
}

/** Lo que cabe en la barra inferior del teléfono. */
export function navMovil(role: UserRole): NavItem[] {
  return TODOS.filter((i) => i.movil && permitido(role, i.permiso))
    .map(({ href, label, icon }) => ({ href, label, icon }))
    .slice(0, 5)
}
