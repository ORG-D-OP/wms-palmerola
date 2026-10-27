/**
 * Geometría del almacén en metros, tomada de la cadena de cotas del plano A-2.
 * Única fuente: lo que se cambie aquí lo toman el mapa 2D y, más adelante, la vista 3D.
 */
export const NAVE = { ancho: 108, alto: 91 }

export const RACK = { modulo: 5.03, pared: 2.39, pasillo: 3.2 }

/** Posiciones de fondo que caben en cada ancho de módulo. */
const FONDO_POR_MODULO = new Map([
  [RACK.modulo, 4],
  [RACK.pared, 2],
])

export const FRANJAS = {
  superior: { y: 10, alto: 11 },
  media: { y: 25.4, alto: 17 },
  racks: { y: 45.9, alto: 19.59 },
  inferior: { y: 69.86, alto: 11 },
} as const

export type Franja = keyof typeof FRANJAS

export type Celda = { x: number; y: number; w: number; h: number }

export type Bloque = {
  code: string
  tipo: 'piso' | 'rack' | 'preparacion'
  franja: Franja
  x: number
  ancho: number
  celdas: Celda[]
}

type DefPiso = { code: string; franja: Franja; x: number; ancho: number; cols: number; filas: number }

/**
 * Bloques de piso con las columnas y filas que les numera el plano.
 * F5 cierra a la derecha en la misma línea que F3, y R-SNK abre en la de F4.
 */
const PISO: DefPiso[] = [
  { code: 'F1', franja: 'superior', x: 1.4, ancho: 34.8, cols: 25, filas: 11 },
  { code: 'F2', franja: 'superior', x: 55.5, ancho: 44.4, cols: 34, filas: 11 },
  { code: 'F3', franja: 'media', x: 1.4, ancho: 46, cols: 33, filas: 18 },
  { code: 'F4', franja: 'media', x: 55.5, ancho: 51.6, cols: 37, filas: 17 },
  { code: 'F5', franja: 'racks', x: 28.2, ancho: 19.2, cols: 14, filas: 19 },
  { code: 'F6', franja: 'inferior', x: 1.4, ancho: 34.8, cols: 25, filas: 11 },
  { code: 'F7', franja: 'inferior', x: 55.5, ancho: 44.4, cols: 32, filas: 11 },
]

type DefRack = { code: string; x: number; modulos: number[]; bahias: number }

/** Cada módulo es un rack; entre módulo y módulo va el pasillo. */
const RACKS: DefRack[] = [
  { code: 'R-ABA', x: 0.56, modulos: [RACK.pared, RACK.modulo, RACK.modulo, RACK.pared], bahias: 16 },
  { code: 'R-SNK', x: 55.5, modulos: Array.from({ length: 6 }, () => RACK.modulo), bahias: 16 },
]

const PREPARACION: { code: string; franja: Franja; x: number; ancho: number }[] = [
  { code: 'PREP-N', franja: 'superior', x: 37.4, ancho: 17 },
  { code: 'PREP-S', franja: 'inferior', x: 37.4, ancho: 17 },
]

const HUECO = 0.14

function celdasPiso(b: DefPiso): Celda[] {
  const f = FRANJAS[b.franja]
  const pasoX = b.ancho / b.cols
  const pasoY = f.alto / b.filas
  const celdas: Celda[] = []
  for (let c = 0; c < b.cols; c++) {
    for (let r = 0; r < b.filas; r++) {
      celdas.push({
        x: b.x + c * pasoX + pasoX * HUECO,
        y: f.y + r * pasoY + pasoY * HUECO,
        w: pasoX * (1 - 2 * HUECO),
        h: pasoY * (1 - 2 * HUECO),
      })
    }
  }
  return celdas
}

function celdasRack(b: DefRack): Celda[] {
  const f = FRANJAS.racks
  const pasoY = f.alto / b.bahias
  const celdas: Celda[] = []
  let x = b.x

  for (const ancho of b.modulos) {
    const fondo = FONDO_POR_MODULO.get(ancho) ?? 2
    const pasoX = ancho / fondo
    for (let d = 0; d < fondo; d++) {
      for (let r = 0; r < b.bahias; r++) {
        celdas.push({
          x: x + d * pasoX + pasoX * HUECO,
          y: f.y + r * pasoY + pasoY * HUECO,
          w: pasoX * (1 - 2 * HUECO),
          h: pasoY * (1 - 2 * HUECO),
        })
      }
    }
    x += ancho + RACK.pasillo
  }
  return celdas
}

export const BLOQUES: Bloque[] = [
  ...PISO.map((b) => ({
    code: b.code,
    tipo: 'piso' as const,
    franja: b.franja,
    x: b.x,
    ancho: b.ancho,
    celdas: celdasPiso(b),
  })),
  ...RACKS.map((b) => ({
    code: b.code,
    tipo: 'rack' as const,
    franja: 'racks' as const,
    x: b.x,
    ancho: b.modulos.reduce((a, m) => a + m, 0) + RACK.pasillo * (b.modulos.length - 1),
    celdas: celdasRack(b),
  })),
  ...PREPARACION.map((b) => ({
    code: b.code,
    tipo: 'preparacion' as const,
    franja: b.franja,
    x: b.x,
    ancho: b.ancho,
    celdas: [],
  })),
]

export const ANDENES = { norte: 15, sur: 14 }

export const COLOR = {
  azul: '#2c2b8f',
  blanco: '#ffffff',
  celeste: '#009bdd',
  verde: '#37f0b4',
  borde: 'rgba(44, 43, 143, 0.35)',
}
