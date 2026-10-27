'use client'

import { Icon } from './icon'
import { CAMPO, ETIQUETA } from './campos'

/**
 * Campo de escaneo. Va fuera de cualquier render: si se declara dentro, React lo
 * recrea en cada actualizacion, el campo pierde el foco y el lector deja de servir.
 */
export function ScanInput({
  label,
  disabled,
  onScan,
}: {
  label: string
  disabled: boolean
  onScan: (code: string) => void
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={ETIQUETA}>{label}</span>
      <span className="relative flex items-center">
        <Icon name="barcode_scanner" className="pointer-events-none absolute left-3 text-azul/40" />
        <input
          autoFocus
          inputMode="none"
          disabled={disabled}
          className={`${CAMPO} pl-12`}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            onScan(e.currentTarget.value)
            e.currentTarget.value = ''
          }}
        />
      </span>
    </label>
  )
}
