import { Icon } from './ui/icon'

/**
 * Alzado del módulo: la vista desde arriba no muestra niveles, así que al llegar al
 * pasillo el operario ve aquí la cara del rack con sus niveles y la profundidad
 * frente/fondo, con la celda exacta resaltada.
 */
const RACK_RE = /^(R-[A-Z]+)-L(\d+)-B(\d+)-N(\d+)-P(\d)$/

export function RackElevation({ code, niveles }: { code: string; niveles: number }) {
  const m = code.match(RACK_RE)
  if (!m) return null

  const bahia = Number(m[3])
  const nivel = Number(m[4])
  const fondo = Number(m[5])

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-borde p-4">
      <div className="flex flex-col-reverse gap-1">
        {Array.from({ length: niveles }, (_, i) => i + 1).map((n) => (
          <div key={n} className="flex items-center gap-1.5">
            <span
              className={`w-5 text-right text-[11px] ${
                n === nivel ? 'text-azul' : 'text-azul/40'
              }`}
            >
              N{n}
            </span>
            {[1, 2].map((p) => {
              const activa = n === nivel && p === fondo
              return (
                <span
                  key={p}
                  className={`h-6 w-9 rounded ${
                    activa ? 'bg-[var(--verde)] ring-2 ring-azul' : 'bg-azul-08'
                  }`}
                />
              )
            })}
          </div>
        ))}
        <div className="flex gap-1.5 pl-[26px] text-[10px] text-azul/50">
          <span className="w-9 text-center">Frente</span>
          <span className="w-9 text-center">Fondo</span>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm text-azul/60">
          <Icon name="shelves" className="!text-[18px]" />
          Bahía {bahia}
        </p>
        <p className="mt-1 text-lg">
          Nivel {nivel}, {fondo === 1 ? 'al frente' : 'al fondo'}
        </p>
        {fondo === 2 ? (
          <p className="mt-1 text-sm text-azul/60">
            Está detrás: hay que bajar primero el pallet de enfrente.
          </p>
        ) : null}
      </div>
    </div>
  )
}
