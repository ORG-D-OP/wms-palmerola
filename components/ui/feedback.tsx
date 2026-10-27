import { Icon } from './icon'

/**
 * El rojo no está en la paleta del manual; el usuario lo autorizó solo para errores,
 * porque en bodega un aviso tiene que despegarse del azul institucional.
 */
export function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-xl bg-rojo p-3 text-white">
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
