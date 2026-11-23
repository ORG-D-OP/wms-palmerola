import { can, type Permission, type UserRole } from '@/lib/auth/roles'

/**
 * Los grupos de la barra lateral de escritorio, en el orden en que se enseñan: primero lo que
 * se hace con las manos, después lo que se consulta y se cuadra, al final lo del jefe.
 */
const GRUPOS = {
  operacion: 'Operación',
  inventario: 'Inventario',
  administracion: 'Administración',
} as const

type Grupo = keyof typeof GRUPOS

/**
 * La barra inferior del teléfono no aguanta más de cinco; lo que sobra queda en la barra
 * lateral de escritorio y en el tablero. El orden es el del día: primero lo que se hace con
 * las manos, después lo que se consulta.
 *
 * El orden de esta lista manda en todas partes —la barra de abajo son sus cinco primeros con
 * `movil`—, así que `grupo` ordena la lateral sin tocarlo.
 */
const TODOS = [
  { href: '/', label: 'Tablero', icon: 'dashboard', permiso: null, movil: true, grupo: null },
  {
    href: '/ingreso',
    label: 'Ingreso',
    icon: 'local_shipping',
    permiso: 'inventario:mover',
    movil: true,
    grupo: 'operacion',
  },
  {
    href: '/despacho',
    label: 'Despacho',
    icon: 'outbound',
    permiso: 'inventario:mover',
    movil: true,
    grupo: 'operacion',
  },
  {
    href: '/guardar',
    label: 'Guardar',
    icon: 'shelves',
    permiso: 'inventario:mover',
    movil: true,
    grupo: 'operacion',
    viaje: true,
  },
  {
    href: '/surtir',
    label: 'Surtir',
    icon: 'shopping_basket',
    permiso: 'surtido:ejecutar',
    movil: true,
    grupo: 'operacion',
    viaje: true,
  },
  {
    href: '/inventario',
    label: 'Buscar',
    icon: 'search',
    permiso: 'inventario:ver',
    movil: true,
    grupo: 'inventario',
  },
  {
    href: '/turno',
    label: 'Disponibilidad',
    icon: 'badge',
    permiso: 'turno:iniciar',
    movil: false,
    grupo: 'operacion',
  },
  {
    href: '/carga-inicial',
    label: 'Carga inicial',
    icon: 'move_to_inbox',
    permiso: 'inventario:mover',
    movil: false,
    grupo: 'operacion',
  },
  {
    href: '/retornables',
    label: 'Retornables',
    icon: 'recycling',
    permiso: 'inventario:mover',
    movil: false,
    grupo: 'operacion',
  },
  {
    href: '/reordenar',
    label: 'Reordenar',
    icon: 'swap_horiz',
    permiso: 'inventario:mover',
    movil: false,
    grupo: 'operacion',
    viaje: true,
  },
  {
    href: '/contar',
    label: 'Contar',
    icon: 'checklist',
    permiso: 'conteo:ejecutar',
    movil: false,
    grupo: 'inventario',
    viaje: true,
  },
  {
    href: '/reabastecer',
    label: 'Reabastecer',
    icon: 'moving',
    permiso: 'reabastecimiento:lanzar',
    movil: false,
    grupo: 'inventario',
  },
  {
    href: '/conteos',
    label: 'Conteos cíclicos',
    icon: 'event_repeat',
    permiso: 'conteo:lanzar',
    movil: false,
    grupo: 'inventario',
  },
  {
    href: '/kpi',
    label: 'Indicadores',
    icon: 'insights',
    permiso: 'kpi:ver',
    movil: false,
    grupo: 'administracion',
  },
  {
    href: '/productos',
    label: 'Productos',
    icon: 'inventory_2',
    permiso: null,
    movil: false,
    grupo: 'inventario',
  },
  {
    href: '/personal',
    label: 'Personal',
    icon: 'badge',
    permiso: 'personal:administrar',
    movil: false,
    grupo: 'administracion',
  },
  {
    href: '/areas',
    label: 'Áreas',
    icon: 'dashboard_customize',
    permiso: 'areas:administrar',
    movil: false,
    grupo: 'administracion',
  },
] as const satisfies readonly {
  href: string
  label: string
  icon: string
  permiso: Permission | null
  movil: boolean
  grupo: Grupo | null
  /**
   * Pantallas que mandan a caminar: tomar una tarea y llevar un pallet de un lado a otro. Al
   * que trabaja de chequeador no se le ofrecen, porque no se mueve del andén. Quien manda es
   * la base —`claim_next_task` no le reparte esas tareas—; esto sólo evita el botón que
   * siempre contesta que no.
   */
  viaje?: boolean
}[]

export type NavItem = { href: string; label: string; icon: string }
export type NavGrupo = { titulo: string; items: NavItem[] }

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

const limpio = ({ href, label, icon }: NavItem): NavItem => ({ href, label, icon })

/**
 * La barra lateral de escritorio: lo mismo que el tablero ofrece, pero repartido en bloques
 * con título. Diecisiete enlaces en una sola fila no caben en ninguna pantalla.
 */
export function navAgrupado(
  role: Roles,
  trabajo: Trabajo = {},
): { sueltos: NavItem[]; grupos: NavGrupo[] } {
  const items = TODOS.filter((i) => visible(role, trabajo, i))
  return {
    sueltos: items.filter((i) => i.grupo === null).map(limpio),
    grupos: Object.entries(GRUPOS)
      .map(([clave, titulo]) => ({
        titulo,
        items: items.filter((i) => i.grupo === clave).map(limpio),
      }))
      .filter((g) => g.items.length > 0),
  }
}

/** Lo que cabe en la barra inferior del teléfono. */
export function navMovil(role: Roles, trabajo: Trabajo = {}): NavItem[] {
  return TODOS.filter((i) => i.movil && visible(role, trabajo, i))
    .map(limpio)
    .slice(0, 5)
}

/**
 * Los atajos del tablero: todas las pantallas a las que la persona tiene derecho.
 *
 * Es el índice completo, no un resumen, porque en el teléfono no hay otro: la barra de abajo
 * sólo lleva cinco y la lateral no existe debajo de `md`. Mientras esto filtró por `movil`,
 * reordenar, contar, los conteos y media administración no tenían forma de abrirse desde un
 * teléfono.
 *
 * Cada atajo lleva su `movil` porque el tablero decide con eso dónde se enseña: en el teléfono
 * se enseña lo que no cabe en la barra de abajo, y en pantalla grande sólo las de mano, como
 * botones pequeños. La lateral ya lleva el resto.
 */
export function atajos(role: Roles, trabajo: Trabajo = {}): (NavItem & { movil: boolean })[] {
  return TODOS.filter((i) => i.href !== '/' && visible(role, trabajo, i)).map(
    ({ href, label, icon, movil }) => ({ href, label, icon, movil }),
  )
}
