'use client'

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
      <span className="text-sm font-medium">{label}</span>
      <input
        autoFocus
        inputMode="none"
        disabled={disabled}
        className="h-14 w-full rounded-lg border border-black/15 px-3 text-lg dark:border-white/20"
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          onScan(e.currentTarget.value)
          e.currentTarget.value = ''
        }}
      />
    </label>
  )
}
