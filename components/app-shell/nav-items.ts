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
  {
    href: '/guardar',
    label: 'Guardar',
    icon: 'shelves',
    permiso: 'inventario:mover',
    movil: true,
    viaje: true,
  },
  {
    href: '/surtir',
    label: 'Surtir',
    icon: 'shopping_basket',
    permiso: 'surtido:ejecutar',
    movil: true,
    viaje: true,
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
    href: '/reordenar',
    label: 'Reordenar',
    icon: 'swap_horiz',
    permiso: 'inventario:mover',
    movil: false,
    viaje: true,
  },
  {
    href: '/contar',
    label: 'Contar',
    icon: 'checklist',
    permiso: 'conteo:ejecutar',
    movil: false,
  },
  {
    href: '/reabastecer',
    label: 'Reabastecer',
    icon: 'moving',
    permiso: 'reabastecimiento:lanzar',
    movil: false,
  },
  {
    href: '/conteos',
    label: 'Conteos cíclicos',
    icon: 'event_repeat',
    permiso: 'conteo:lanzar',
    movil: false,
  },
  { href: '/kpi', label: 'Indicadores', icon: 'insights', permiso: 'kpi:ver', movil: false },
  { href: '/productos', label: 'Productos', icon: 'inventory_2', permiso: null, movil: false },
  {
    href: '/personal',
    label: 'Personal',
    icon: 'badge',
    permiso: 'personal:administrar',
    movil: false,
  },
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
  /**
   * Pantallas que mandan a caminar: tomar una tarea y llevar un pallet de un lado a otro. Al
   * que trabaja de chequeador no se le ofrecen, porque no se mueve del andén. Quien manda es
   * la base —`claim_next_task` no le reparte esas tareas—; esto sólo evita el botón que
   * siempre contesta que no.
   */
  viaje?: boolean
}[]

export type NavItem = { href: string; label: string; icon: string }

type Roles = UserRole | readonly UserRole[]

const permitido = (roles: Roles, permiso: Permission | null) =>
  permiso === null || can(roles, permiso)

/**
 * El rango dice a qué tiene derecho; el rol del turno, a qué le toca hoy. Un chequeador de
 * rango que entró a trabajar de auxiliar guarda pallets como todos, y por eso el viaje se mira
 * aparte del permiso.
 */
/**
 * El rol del turno esconde las pantallas de viaje, pero nunca a quien anda con algo en la
 * mano: la tarea empezada es suya hasta que la cierre, y `trabajar_como` no deja cambiar de
 * rol con algo empezado. Sin esto, cambiarse a chequeador a media tarea deja encerrado.
 */
export type Trabajo = { rol?: UserRole; enMano?: boolean }

const visible = (roles: Roles, trabajo: Trabajo, item: (typeof TODOS)[number]) =>
  permitido(roles, item.permiso) &&
  (!('viaje' in item) || trabajo.rol !== 'chequeador' || trabajo.enMano === true)

export function navParaRol(role: Roles, trabajo: Trabajo = {}): NavItem[] {
  return TODOS.filter((i) => visible(role, trabajo, i)).map(({ href, label, icon }) => ({
    href,
    label,
    icon,
  }))
}

/** Lo que cabe en la barra inferior del teléfono. */
export function navMovil(role: Roles, trabajo: Trabajo = {}): NavItem[] {
  return TODOS.filter((i) => i.movil && visible(role, trabajo, i))
    .map(({ href, label, icon }) => ({ href, label, icon }))
    .slice(0, 5)
}

/**
 * Los atajos del tablero: todas las pantallas a las que la persona tiene derecho.
 *
 * Es el índice completo, no un resumen, porque en el teléfono no hay otro: la barra de abajo
 * sólo lleva cinco y la barra de arriba no existe debajo de `md`. Mientras esto filtró por
 * `movil`, reordenar, contar, los conteos y media administración no tenían forma de abrirse
 * desde un teléfono.
 *
 * Cada atajo lleva su `movil` porque el tablero decide con eso dónde se enseña: las cinco que
 * ya están en la barra de abajo se esconden en el teléfono y vuelven en pantalla grande, y las
 * que no son de mano se enseñan en el teléfono y se esconden en pantalla grande, donde la
 * barra de arriba ya las lleva. La misma fila de enlaces dos veces no ayuda a nadie.
 */
export function atajos(role: Roles, trabajo: Trabajo = {}): (NavItem & { movil: boolean })[] {
  return TODOS.filter((i) => i.href !== '/' && visible(role, trabajo, i)).map(
    ({ href, label, icon, movil }) => ({ href, label, icon, movil }),
  )
}
