/**
 * Planta del almacén, reconstruida con las cotas del plano A-2 (108 x 91 m).
 *
 * Todas las medidas están en metros y viven aquí, en un solo lugar:
 *  - Módulo de rack 5.03 m, módulo contra pared 2.39 m, pasillo 3.20 m.
 *  - Bloques de piso con las columnas que les numera el plano.
 * Cuando llegue el plano de racks se ajustan estos números y el dibujo se acomoda solo.
 */
const NAVE = { ancho: 108, alto: 91 }
const MARGEN = 1.4
const RACK = { modulo: 5.03, pared: 2.39, pasillo: 3.2 }

const FRANJAS = {
  superior: { y: 10, alto: 11 },
  media: { y: 25.4, alto: 17 },
  racks: { y: 45.9, alto: 19.59 },
  inferior: { y: 69.86, alto: 11 },
} as const

type Franja = keyof typeof FRANJAS

/** Los bloques de piso se dibujan como sus columnas reales, igual que en el plano. */
const PISO: { code: string; franja: Franja; x: number; ancho: number; columnas: number }[] = [
  { code: 'F1', franja: 'superior', x: MARGEN, ancho: 34.8, columnas: 25 },
  { code: 'F2', franja: 'superior', x: 55.5, ancho: 44.4, columnas: 34 },
  { code: 'F3', franja: 'media', x: MARGEN, ancho: 46, columnas: 33 },
  { code: 'F4', franja: 'media', x: 55.5, ancho: 51.6, columnas: 37 },
  { code: 'F5', franja: 'racks', x: 29.59, ancho: 19.2, columnas: 14 },
  { code: 'F6', franja: 'inferior', x: MARGEN, ancho: 34.8, columnas: 25 },
  { code: 'F7', franja: 'inferior', x: 55.5, ancho: 44.4, columnas: 32 },
]

/** Cada módulo es un rack; entre módulo y módulo va el pasillo de 3.20 m. */
const RACKS: { code: string; x: number; modulos: number[] }[] = [
  {
    code: 'R-ABA',
    x: MARGEN + 0.56,
    modulos: [RACK.pared, RACK.modulo, RACK.modulo, RACK.pared],
  },
  {
    code: 'R-SNK',
    x: 57.49,
    // Seis modulos y cinco pasillos, como los numera la cadena de cotas del plano.
    // Lo que queda hasta la pared es el area de montacargas.
    modulos: Array.from({ length: 6 }, () => RACK.modulo),
  },
]

const PREPARACION: { code: string; franja: Franja; x: number; ancho: number }[] = [
  { code: 'PREP-N', franja: 'superior', x: 37.4, ancho: 17 },
  { code: 'PREP-S', franja: 'inferior', x: 37.4, ancho: 17 },
]

const ANDENES = { norte: 15, sur: 14 }

export type Ocupacion = Record<string, { ocupadas: number; total: number }>

const tinte = (pct: number) => 0.1 + pct * 0.8

export function WarehouseMap({ ocupacion }: { ocupacion: Ocupacion }) {
  const pct = (code: string) => {
    const d = ocupacion[code]
    return d && d.total > 0 ? d.ocupadas / d.total : 0
  }

  return (
    <svg
      viewBox={`0 0 ${NAVE.ancho} ${NAVE.alto}`}
      className="w-full rounded-2xl border border-borde bg-white"
      role="img"
      aria-label="Planta del almacén con la ocupación de cada bloque"
    >
      <defs>
        <linearGradient id="rackLleno" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#0049e8" />
          <stop offset="100%" stopColor="#37f0b4" />
        </linearGradient>
      </defs>

      <rect
        x={0.4}
        y={0.4}
        width={NAVE.ancho - 0.8}
        height={NAVE.alto - 0.8}
        rx={1}
        fill="none"
        stroke="#2c2b8f"
        strokeOpacity={0.35}
        strokeWidth={0.4}
      />

      {Array.from({ length: ANDENES.norte }, (_, i) => (
        <rect key={`n${i}`} x={4 + i * 6.7} y={1.4} width={5} height={1.9} rx={0.4} fill="#009bdd" />
      ))}
      {Array.from({ length: ANDENES.sur }, (_, i) => (
        <rect
          key={`s${i}`}
          x={4 + i * 6.7}
          y={NAVE.alto - 3.3}
          width={5}
          height={1.9}
          rx={0.4}
          fill="#37f0b4"
        />
      ))}
      <text x={4} y={6.2} fontSize={2.1} fill="#2c2b8f" fillOpacity={0.55}>
        Descarga
      </text>
      <text x={4} y={NAVE.alto - 4.6} fontSize={2.1} fill="#2c2b8f" fillOpacity={0.55}>
        Carga
      </text>

      {PISO.map((b) => {
        const f = FRANJAS[b.franja]
        const paso = b.ancho / b.columnas
        const ocupado = pct(b.code)
        return (
          <g key={b.code}>
            {Array.from({ length: b.columnas }, (_, i) => (
              <rect
                key={i}
                x={b.x + i * paso + paso * 0.14}
                y={f.y}
                width={paso * 0.72}
                height={f.alto}
                fill="#2c2b8f"
                fillOpacity={tinte(ocupado)}
              />
            ))}
            <text
              x={b.x + b.ancho / 2}
              y={f.y + f.alto / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={2.8}
              fill={ocupado > 0.5 ? '#ffffff' : '#2c2b8f'}
            >
              {b.code}
            </text>
          </g>
        )
      })}

      {RACKS.map((b) => {
        const f = FRANJAS.racks
        const ocupado = pct(b.code)
        let x = b.x
        const modulos = b.modulos.map((ancho) => {
          const actual = x
          x += ancho + RACK.pasillo
          return { x: actual, ancho }
        })
        return (
          <g key={b.code}>
            {modulos.map((m, i) => (
              <g key={i}>
                <rect
                  x={m.x}
                  y={f.y}
                  width={m.ancho}
                  height={f.alto}
                  rx={0.4}
                  fill="#2c2b8f"
                  fillOpacity={tinte(ocupado)}
                />
                <rect
                  x={m.x}
                  y={f.y + f.alto * (1 - Math.max(ocupado, 0.02))}
                  width={m.ancho}
                  height={f.alto * Math.max(ocupado, 0.02)}
                  rx={0.4}
                  fill="url(#rackLleno)"
                />
              </g>
            ))}
            <text x={b.x} y={f.y - 1.4} fontSize={2.5} fill="#2c2b8f" fillOpacity={0.8}>
              {b.code}
            </text>
          </g>
        )
      })}

      {PREPARACION.map((p) => {
        const f = FRANJAS[p.franja]
        return (
          <g key={p.code}>
            <rect
              x={p.x}
              y={f.y}
              width={p.ancho}
              height={f.alto}
              rx={0.8}
              fill="none"
              stroke="#2c2b8f"
              strokeOpacity={0.3}
              strokeWidth={0.3}
              strokeDasharray="1.4 1.4"
            />
            <text
              x={p.x + p.ancho / 2}
              y={f.y + f.alto / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={2.2}
              fill="#2c2b8f"
              fillOpacity={0.55}
            >
              Preparación
            </text>
          </g>
        )
      })}
    </svg>
  )
}
