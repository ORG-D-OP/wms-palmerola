/**
 * Geometría del almacén en metros, tomada de la cadena de cotas del plano A-2.
 * Única fuente: lo que se cambie aquí lo toman el mapa 2D y, más adelante, la vista 3D.
 */
export const NAVE = { ancho: 108, alto: 91 }

export const RACK = { modulo: 5.03, pared: 2.39, pasillo: 3.2 }

/**
 * Altura entre niveles y apilado en piso. **Provisional**: falta el plano A-03.
 * Solo afecta a la vista 3D; cambiar estos números la reconstruye entera.
 */
export const ALTURA = { nivel: 1.8, piso: 1.5 }

/**
 * Posiciones de fondo por carril. Es el `lane_depth` de `zone_spec`: doble profundidad.
 * Si algún día se cambia allá, hay que cambiarlo aquí, que es lo que numera el dibujo.
 */
const FONDO_POR_CARRIL = 2

/**
 * Un módulo de rack y por dónde se le entra, que es lo que decide cuál columna es el frente.
 * El de en medio tiene pasillo de los dos lados: lleva dos carriles espalda con espalda y
 * cada uno da la cara al suyo, así que los frentes son la primera columna y la última. El de
 * pared sólo tiene pasillo de un lado y su único carril da la cara para adentro.
 */
type Modulo = { ancho: number; fondos: number; pared?: 'izquierda' | 'derecha' }

const ENTRE_PASILLOS: Modulo = { ancho: RACK.modulo, fondos: 4 }
const CONTRA_LA_PARED = (pared: 'izquierda' | 'derecha'): Modulo => ({
  ancho: RACK.pared,
  fondos: FONDO_POR_CARRIL,
  pared,
})

export const FRANJAS = {
  superior: { y: 10, alto: 11 },
  media: { y: 25.4, alto: 17 },
  // La franja de los racks sale del maestro del 12/11/2026, no de la cadena de cotas: iba
  // 30 cm corrida y el cuadro quedaba fuera de su posicion.
  racks: { y: 46.21, alto: 19.03 },
  inferior: { y: 69.86, alto: 11 },
} as const

export type Franja = keyof typeof FRANJAS

/**
 * Un cuadro de la planta. `code` es el codigo de la posicion real: en piso, el codigo
 * completo; en rack, el de la pila sin el `-N#`, porque desde arriba seis niveles son un
 * solo cuadro. Con esto el mapa pinta posicion por posicion en lugar de pintar la zona
 * entera del mismo tono.
 */
export type Celda = { code: string; x: number; y: number; w: number; h: number }

const pad = (n: number, largo: number) => String(n).padStart(largo, '0')

/** El cuadro de planta al que pertenece una posicion: en rack, su pila de niveles. */
export function claveDePlanta(code: string): string {
  return code.replace(/-N\d+-/, '-')
}

export type Bloque = {
  code: string
  tipo: 'piso' | 'rack' | 'preparacion'
  franja: Franja
  x: number
  ancho: number
  celdas: Celda[]
  /** Solo en racks: cuántos niveles tiene cada posición de la planta. */
  niveles?: number
}

type DefPiso = { code: string; franja: Franja; x: number; ancho: number; cols: number; filas: number }

/**
 * Bloques de piso con las columnas y filas que les numera el plano.
 * F5 cierra a la derecha en la misma línea que F3, y R-SNK abre en la de F4.
 */
const PISO: DefPiso[] = [
  { code: 'F1', franja: 'superior', x: 1.4, ancho: 34.8, cols: 25, filas: 11 },
  { code: 'F2', franja: 'superior', x: 55.5, ancho: 47.8, cols: 34, filas: 11 },
  { code: 'F3', franja: 'media', x: 1.4, ancho: 46, cols: 33, filas: 18 },
  { code: 'F4', franja: 'media', x: 55.5, ancho: 51.6, cols: 37, filas: 17 },
  { code: 'F5', franja: 'racks', x: 28.2, ancho: 19.2, cols: 14, filas: 19 },
  { code: 'F6', franja: 'inferior', x: 1.4, ancho: 34.8, cols: 25, filas: 11 },
  { code: 'F7', franja: 'inferior', x: 55.5, ancho: 44.4, cols: 32, filas: 11 },
]

type DefRack = { code: string; x: number; modulos: Modulo[]; bahias: number; niveles: number }

/**
 * Cada módulo es un rack; entre módulo y módulo va el pasillo.
 * Los módulos y las bahías salen de las cotas del plano y cuadran exactamente con las
 * posiciones declaradas: abarrotes 12 de fondo x 16 bahías x 6 niveles = 1,152, y
 * snacks 26 x 16 x 4 = 1,664.
 *
 * Si el plano de racks dice otra altura hay que cambiarla en DOS lugares: aquí, que es
 * lo que dibujan el mapa y el 3D, y la fila de `zone_spec` en la base, que es lo que
 * genera las posiciones. Después, `select generate_zone_locations('R-ABA')`.
 */
const RACKS: DefRack[] = [
  {
    code: 'R-ABA',
    x: 0.56,
    modulos: [
      CONTRA_LA_PARED('izquierda'),
      ENTRE_PASILLOS,
      ENTRE_PASILLOS,
      CONTRA_LA_PARED('derecha'),
    ],
    bahias: 16,
    niveles: 6,
  },
  {
    code: 'R-SNK',
    x: 55.5,
    modulos: [
      ...Array.from({ length: 6 }, () => ENTRE_PASILLOS),
      CONTRA_LA_PARED('derecha'),
    ],
    bahias: 16,
    niveles: 4,
  },
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
        code: `${b.code}-${pad(c + 1, 3)}-${pad(r + 1, 2)}`,
        x: b.x + c * pasoX + pasoX * HUECO,
        y: f.y + r * pasoY + pasoY * HUECO,
        w: pasoX * (1 - 2 * HUECO),
        h: pasoY * (1 - 2 * HUECO),
      })
    }
  }
  return celdas
}

/**
 * Qué columna del módulo es el frente del carril `c`. El frente es la que da al pasillo, y
 * por eso no se puede numerar de corrido: en un módulo de en medio los dos carriles se dan la
 * espalda, así que el primero da la cara a la izquierda y el segundo a la derecha. Numerarlo
 * de corrido ponía el frente de la mitad de los carriles sobre la posición de atrás, y el
 * mapa pintaba de picking un fondo.
 */
function frenteALaIzquierda(m: Modulo, c: number, carriles: number) {
  return m.pared ? m.pared === 'derecha' : c < carriles / 2
}

function celdasRack(b: DefRack): Celda[] {
  const f = FRANJAS.racks
  const pasoY = f.alto / b.bahias
  const celdas: Celda[] = []
  let x = b.x
  // Los carriles se numeran de corrido por toda la zona, igual que los genera la base.
  let carril = 0

  for (const m of b.modulos) {
    const pasoX = m.ancho / m.fondos
    const carriles = m.fondos / FONDO_POR_CARRIL
    for (let c = 0; c < carriles; c++) {
      carril++
      const izquierda = frenteALaIzquierda(m, c, carriles)
      for (let p = 0; p < FONDO_POR_CARRIL; p++) {
        const columna = c * FONDO_POR_CARRIL + (izquierda ? p : FONDO_POR_CARRIL - 1 - p)
        for (let r = 0; r < b.bahias; r++) {
          celdas.push({
            code: `${b.code}-L${pad(carril, 2)}-B${pad(r + 1, 2)}-P${p + 1}`,
            x: x + columna * pasoX + pasoX * HUECO,
            y: f.y + r * pasoY + pasoY * HUECO,
            w: pasoX * (1 - 2 * HUECO),
            h: pasoY * (1 - 2 * HUECO),
          })
        }
      }
    }
    x += m.ancho + RACK.pasillo
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
    niveles: b.niveles,
    x: b.x,
    ancho: b.modulos.reduce((a, m) => a + m.ancho, 0) + RACK.pasillo * (b.modulos.length - 1),
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

/**
 * Los 24 andenes: 1 al 14 en la franja sur, junto a oficinas, y 15 al 24 en la del norte. En
 * la del norte la numeración va al revés —el 15 es el de la derecha del todo—, así que el
 * sitio de un andén del norte se cuenta desde el otro extremo.
 */
export const ANDENES = { norte: 10, sur: 14, primeroDelNorte: 15 }

/** De qué franja es un andén y qué lugar ocupa en ella, contando desde la izquierda. */
export function sitioDelAnden(n: number): { norte: boolean; i: number } | null {
  if (n < 1 || n > ANDENES.sur + ANDENES.norte) return null
  if (n <= ANDENES.sur) return { norte: false, i: n }
  return { norte: true, i: ANDENES.sur + ANDENES.norte + 1 - n }
}

export const COLOR = {
  azul: '#2c2b8f',
  blanco: '#ffffff',
  celeste: '#009bdd',
  verde: '#37f0b4',
  borde: 'rgba(44, 43, 143, 0.35)',
}

/** Un color de marca aclarado sobre blanco. `t` es cuánto queda del color: 1 es el color. */
function aclarado(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16)
  const canal = (desplazamiento: number) =>
    Math.round(255 - (255 - ((n >> desplazamiento) & 255)) * t)
  return `rgb(${canal(16)}, ${canal(8)}, ${canal(0)})`
}

/**
 * Los colores de la ocupación. Enteros y no el azul con transparencia, por lo mismo que la
 * planimetría: el isométrico no pinta transparencia, así que el mismo estado salía de un
 * color en el mapa de arriba y de otro en el de cajas, y la leyenda dejaba de ser la llave
 * de ninguno de los dos. Mapa, isométrico y leyenda leen de aquí.
 *
 * El otro uso es gris a propósito: es lo único que no guarda producto, y sin tinte de marca
 * no se confunde con un azul flojo.
 */
export const OCUPACION = {
  libre: aclarado(COLOR.azul, 0.08),
  apartada: COLOR.celeste,
  otroUso: '#aeaebe',
}

/**
 * Lo lleno que está el cuadro, de blanco a azul. Arranca al 62% y no en cero: por debajo de
 * eso un cuadro con un pallet se leía más claro que uno de otro uso y parecía estar más vacío.
 */
const TONO_MINIMO = 0.62

export function tonoOcupada(fraccion: number): string {
  const f = Math.max(0, Math.min(1, fraccion))
  return aclarado(COLOR.azul, TONO_MINIMO + f * (1 - TONO_MINIMO))
}

/**
 * El color de la planimetría: el tinte dice el grupo —azul el alimento, verde lo que no lo
 * es— y la fuerza dice el oficio: subido, la cara de picking; apagado, la reserva.
 *
 * El no alimento iba en celeste, que es el mismo celeste con que la ocupación pinta lo
 * apartado por una tarea: los dos mapas salían del mismo par de tintes y cambiar de modo no
 * se notaba. Con el verde, la planimetría no comparte ni un color con la ocupación.
 */
export const PLANIMETRIA = {
  ALIMENTO: { cara: COLOR.azul, reserva: aclarado(COLOR.azul, 0.18) },
  NO_ALIMENTO: { cara: aclarado(COLOR.verde, 0.95), reserva: aclarado(COLOR.verde, 0.3) },
}

/**
 * El grupo es de la corrida entera, así que va por cuadro. El oficio no: la cara de un rack es
 * el nivel 1 del frente, así que cada vista pregunta por lo que pinta —el mapa de arriba por
 * cuadro, el isométrico por posición— y lo que manda la base es el código de la posición
 * (migración 0102).
 */
export function colorPlanimetria(code: string, noAlimento: Set<string>, picking: Set<string>) {
  const tinte = noAlimento.has(claveDePlanta(code))
    ? PLANIMETRIA.NO_ALIMENTO
    : PLANIMETRIA.ALIMENTO
  return picking.has(code) ? tinte.cara : tinte.reserva
}


/**
 * Una caja de la vista 3D: posición en planta más el nivel en el que está. `code` es el
 * código completo de esa posición, nivel incluido, así que el 3D puede pintar ocupada la
 * posición exacta y no la zona entera.
 */
export type Caja = {
  code: string
  x: number
  z: number
  w: number
  d: number
  y: number
  alto: number
}

/**
 * Cuántos pallets hay encima de una posición de piso y cuántos le caben, por su código.
 *
 * En el rack la pila es la estantería y la dibuja la geometría: seis niveles son seis cajas.
 * En el piso no hay estantería, así que el apilado sale del maestro del producto —las latas
 * aguantan tres y el tetra de la misma familia dos— y sin este dato el mapa pintaba un solo
 * pallet donde hay tres (migración 0047).
 */
export type Pilas = Record<string, { hay: number; caben: number }>

export function cajas(pilas: Pilas = {}): { bloque: Bloque; cajas: Caja[] }[] {
  return BLOQUES.filter((b) => b.tipo !== 'preparacion').map((b) => {
    const rack = b.tipo === 'rack'
    const alto = rack ? ALTURA.nivel * 0.82 : ALTURA.piso
    const lista: Caja[] = []
    for (const c of b.celdas) {
      const pisos = rack ? (b.niveles ?? 1) : Math.max(1, pilas[c.code]?.hay ?? 1)
      for (let n = 0; n < pisos; n++) {
        lista.push({
          code: rack ? c.code.replace(/-P(\d)$/, `-N${n + 1}-P$1`) : c.code,
          x: c.x,
          z: c.y,
          w: c.w,
          d: c.h,
          y: n * (rack ? ALTURA.nivel : ALTURA.piso),
          alto,
        })
      }
    }
    return { bloque: b, cajas: lista }
  })
}

/** Centro de una posición, en metros, a partir de su código. */
export type Punto = { x: number; y: number }

const ANDEN_RE = /^STG-AND-(\d+)$/

/**
 * El centro de cada cuadro de la planta. Sale de los mismos cuadros que pinta el mapa, no de
 * rehacer la cuenta aparte: dos cuentas de lo mismo acaban diciendo cosas distintas.
 */
const CENTRO = new Map<string, Punto>(
  BLOQUES.flatMap((b) =>
    b.celdas.map((c) => [c.code, { x: c.x + c.w / 2, y: c.y + c.h / 2 }] as const),
  ),
)

/**
 * El cuadro de una posición, no su centro. El mapa marcaba el destino con un círculo encima
 * de la planta y lo que la gente busca es su cuadro: ahora se ilumina el cuadro que es.
 */
const RECTANGULO = new Map<string, Celda>(
  BLOQUES.flatMap((b) => b.celdas.map((c) => [c.code, c] as const)),
)

export function rectangulo(code: string): Celda | null {
  return RECTANGULO.get(claveDePlanta(code)) ?? null
}

export function ubicar(code: string): Punto | null {
  const centro = CENTRO.get(claveDePlanta(code))
  if (centro) return centro

  const anden = code.match(ANDEN_RE)
  if (anden?.[1]) {
    const sitio = sitioDelAnden(Number(anden[1]))
    if (sitio) {
      return { x: 4 + (sitio.i - 1) * 6.7 + 2.5, y: sitio.norte ? 3.3 : NAVE.alto - 3.3 }
    }
  }

  return null
}

/**
 * Andén de descarga más cercano en horizontal a un punto. Son los de recepción de snacks y
 * abarrotería, que es por donde entra lo que hay que guardar.
 */
export const ANDENES_DE_RECEPCION = [9, 10, 11, 12, 13, 14]

export function andenMasCercano(p: Punto): string {
  let mejor = ANDENES_DE_RECEPCION[0]!
  let dist = Infinity
  for (const n of ANDENES_DE_RECEPCION) {
    const sitio = sitioDelAnden(n)
    if (!sitio) continue
    const x = 4 + (sitio.i - 1) * 6.7 + 2.5
    if (Math.abs(x - p.x) < dist) {
      dist = Math.abs(x - p.x)
      mejor = n
    }
  }
  return `STG-AND-${String(mejor).padStart(2, '0')}`
}

/** Pasillos libres por donde circula el montacargas, en metros. */
const CORREDORES_H = [6.5, 23.2, 44, 67.7, 85]
/** Pasillo central entre F3 y F4, más los dos márgenes contra las paredes. */
const CORREDORES_V = [0.7, 51.45, 107.3]

const masCercano = (opciones: number[], valor: number) =>
  opciones.reduce((mejor, o) => (Math.abs(o - valor) < Math.abs(mejor - valor) ? o : mejor))

/**
 * Ruta ortogonal del andén al destino. Solo circula por pasillos reales: baja por
 * el vertical más cercano, cruza por el horizontal que toca al destino y entra al
 * bloque. No es la ruta más corta todavía, pero no atraviesa racks.
 */
export function ruta(desde: Punto, hasta: Punto): Punto[] {
  const vertical = masCercano(CORREDORES_V, hasta.x)
  const horizontal = masCercano(CORREDORES_H, hasta.y)
  const puntos: Punto[] = [
    desde,
    { x: vertical, y: desde.y },
    { x: vertical, y: horizontal },
    { x: hasta.x, y: horizontal },
    hasta,
  ]
  // Quita los puntos que no doblan, para que el trazo no tenga vértices de más.
  return puntos.filter((p, i) => i === 0 || Math.hypot(p.x - puntos[i - 1]!.x, p.y - puntos[i - 1]!.y) > 0.4)
}
