/**
 * Planta del almacen a escala del plano A-2 (108 x 91 m). Cada bloque se tinta segun
 * su ocupacion, del Azul Dinant al 8 % (vacio) al Azul pleno (lleno).
 * Las medidas viven aqui, en un solo lugar, para ajustarlas cuando llegue el plano final.
 */
const NAVE = { ancho: 108, alto: 91 }

type Bloque = { code: string; x: number; y: number; w: number; h: number; paso?: boolean }

const BLOQUES: Bloque[] = [
  { code: 'F1', x: 1.4, y: 6, w: 34.8, h: 11 },
  { code: 'PREP-N', x: 37, y: 6, w: 18.5, h: 11, paso: true },
  { code: 'F2', x: 56, y: 6, w: 44.4, h: 11 },
  { code: 'F3', x: 1.4, y: 21, w: 46, h: 17 },
  { code: 'F4', x: 48.5, y: 21, w: 51.9, h: 17 },
  { code: 'R-ABA', x: 1.4, y: 42, w: 27.6, h: 19.6 },
  { code: 'F5', x: 29.5, y: 42, w: 19.2, h: 19.6 },
  { code: 'R-SNK', x: 49.8, y: 42, w: 50.6, h: 19.6 },
  { code: 'F6', x: 1.4, y: 65.6, w: 34.8, h: 11 },
  { code: 'PREP-S', x: 37, y: 65.6, w: 18.5, h: 11, paso: true },
  { code: 'F7', x: 56, y: 65.6, w: 44.4, h: 11 },
]

const ANDENES = { entrada: 15, salida: 14 }

export type Ocupacion = Record<string, { ocupadas: number; total: number }>

export function WarehouseMap({ ocupacion }: { ocupacion: Ocupacion }) {
  return (
    <svg
      viewBox={`0 0 ${NAVE.ancho} ${NAVE.alto}`}
      className="w-full rounded-2xl border border-borde bg-white"
      role="img"
      aria-label="Planta del almacén con la ocupación de cada bloque"
    >
      <defs>
        <linearGradient id="rack" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0049e8" />
          <stop offset="100%" stopColor="#37f0b4" />
        </linearGradient>
      </defs>

      {Array.from({ length: ANDENES.entrada }, (_, i) => (
        <rect
          key={`n${i}`}
          x={6 + i * 6.4}
          y={0.6}
          width={4.6}
          height={2.4}
          rx={0.6}
          fill="#009bdd"
        />
      ))}

      {BLOQUES.map((b) => {
        const datos = ocupacion[b.code]
        const pct = datos && datos.total > 0 ? datos.ocupadas / datos.total : 0
        const esRack = b.code.startsWith('R-')

        return (
          <g key={b.code}>
            <rect
              x={b.x}
              y={b.y}
              width={b.w}
              height={b.h}
              rx={1}
              fill={b.paso ? 'none' : '#2c2b8f'}
              fillOpacity={b.paso ? 0 : 0.08 + pct * 0.85}
              stroke="#2c2b8f"
              strokeOpacity={b.paso ? 0.25 : 0.35}
              strokeWidth={0.3}
              strokeDasharray={b.paso ? '1.5 1.5' : undefined}
            />
            {esRack ? (
              <rect
                x={b.x}
                y={b.y + b.h - 1.2}
                width={b.w * Math.max(pct, 0.02)}
                height={1.2}
                rx={0.6}
                fill="url(#rack)"
              />
            ) : null}
            <text
              x={b.x + b.w / 2}
              y={b.y + b.h / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={2.6}
              fill={pct > 0.55 && !b.paso ? '#ffffff' : '#2c2b8f'}
              fillOpacity={b.paso ? 0.5 : 1}
            >
              {b.code}
            </text>
            {datos && !b.paso ? (
              <text
                x={b.x + b.w / 2}
                y={b.y + b.h / 2 + 3.2}
                textAnchor="middle"
                fontSize={2}
                fill={pct > 0.55 ? '#ffffff' : '#2c2b8f'}
                fillOpacity={0.7}
              >
                {Math.round(pct * 100)}%
              </text>
            ) : null}
          </g>
        )
      })}

      {Array.from({ length: ANDENES.salida }, (_, i) => (
        <rect
          key={`s${i}`}
          x={6 + i * 6.8}
          y={NAVE.alto - 3}
          width={4.6}
          height={2.4}
          rx={0.6}
          fill="#37f0b4"
        />
      ))}

      <text x={6} y={NAVE.alto - 4.4} fontSize={2.2} fill="#2c2b8f" fillOpacity={0.6}>
        Carga
      </text>
      <text x={6} y={5.2} fontSize={2.2} fill="#2c2b8f" fillOpacity={0.6}>
        Descarga
      </text>
    </svg>
  )
}
