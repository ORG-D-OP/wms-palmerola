import { Icon } from './icon'

/**
 * El manual no tiene un color de error. En vez de salirse de paleta, el aviso usa
 * Azul Dinant pleno con texto blanco y un icono: maxima jerarquia, cero ambiguedad.
 */
export function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-xl bg-azul p-3 text-white">
      <Icon name="error" className="shrink-0" />
      <span className="min-w-0 flex-1 text-sm">{children}</span>
    </p>
  )
}

export function Logro({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-borde bg-[var(--verde)]/20 p-3">
      <Icon name="check_circle" className="shrink-0 text-azul" />
      <span className="min-w-0 flex-1 text-sm">{children}</span>
    </p>
  )
}
