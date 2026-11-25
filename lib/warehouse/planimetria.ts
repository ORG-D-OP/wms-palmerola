import { claveDePlanta } from './plano'

/**
 * El color de la planimetría: el tinte dice el grupo —azul el alimento, celeste lo que no lo
 * es— y la fuerza dice el oficio: subido, la cara de picking; apagado, la reserva. Son los dos
 * cortes que uno necesita para ubicarse, y caben en un solo color por posición.
 *
 * Vive aparte porque lo pintan los dos mapas, el de arriba y el isométrico, y dos tablas de
 * colores acaban diciendo cosas distintas. Cada uno recibe el conjunto que le toca: el mapa de
 * arriba trabaja por cuadro y el isométrico por posición, que lleva el nivel.
 */
export const TINTE = {
  alimento: [44, 43, 143],
  noAlimento: [0, 155, 221],
} as const

/** Subido es la cara que se surte; apagado, todo lo que es reserva. */
export const FUERZA = { cara: 0.62, reserva: 0.16 } as const

export function tintePlanimetria(
  code: string,
  noAlimento: Set<string>,
  picking: Set<string>,
): { rgb: readonly [number, number, number]; alfa: number } {
  return {
    // El grupo es de la corrida entera, así que va por cuadro aunque el código traiga nivel.
    rgb: noAlimento.has(claveDePlanta(code)) ? TINTE.noAlimento : TINTE.alimento,
    alfa: picking.has(code) ? FUERZA.cara : FUERZA.reserva,
  }
}
