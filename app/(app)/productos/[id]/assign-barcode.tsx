'use client'

import { useState, useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'
import { assignBarcode } from './actions'

export function AssignBarcode({ productId, hint }: { productId: string; hint: string | null }) {
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const guardar = (code: string) => {
    if (!code.trim()) return
    setError(null)
    setOk(null)
    startTransition(async () => {
      const res = await assignBarcode(productId, code)
      if (!res.ok) return setError(res.error)
      setOk(res.code)
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <ScanInput label="Escanea la caja para asignar su codigo" disabled={pending} onScan={guardar} />

      {hint ? (
        <p className="text-sm opacity-70">
          El maestro dice <span className="font-mono">{hint}</span>, pero no esta verificado.
          Confirmalo escaneando la caja real.
        </p>
      ) : null}

      {ok ? (
        <p className="text-sm text-green-700 dark:text-green-400">Codigo {ok} asignado.</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  )
}
