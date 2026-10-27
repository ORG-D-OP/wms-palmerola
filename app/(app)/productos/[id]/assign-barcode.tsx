'use client'

import { useState, useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'
import { Aviso, Logro } from '@/components/ui/feedback'
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
      <ScanInput label="Escanea la caja para asignar su código" disabled={pending} onScan={guardar} />

      {hint ? (
        <p className="text-sm text-azul/60">
          El maestro dice <span className="font-mono">{hint}</span>, pero no está verificado.
          Confírmalo escaneando la caja real.
        </p>
      ) : null}

      {ok ? <Logro>Código {ok} asignado.</Logro> : null}
      {error ? <Aviso>{error}</Aviso> : null}
    </div>
  )
}
