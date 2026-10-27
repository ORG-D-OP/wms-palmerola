'use client'

import { useState, useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'
import { Aviso } from '@/components/ui/feedback'
import { BOTON } from '@/components/ui/campos'
import { claimPutaway, completePutaway, startPutaway, type Job } from './actions'


type Paso = 'inicio' | 'tomar' | 'llevar' | 'listo'

export function PutawayForm() {
  const [paso, setPaso] = useState<Paso>('inicio')
  const [job, setJob] = useState<Job | null>(null)
  const [guardadoEn, setGuardadoEn] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vacio, setVacio] = useState(false)
  const [pending, startTransition] = useTransition()

  const tomar = () => {
    setError(null)
    setVacio(false)
    startTransition(async () => {
      const res = await claimPutaway()
      if (!res.ok) return setError(res.error)
      if (!res.job) return setVacio(true)
      setJob(res.job)
      setPaso('tomar')
    })
  }

  const escanear = (code: string) => {
    if (!job || !code.trim()) return
    setError(null)
    startTransition(async () => {
      if (paso === 'tomar') {
        const res = await startPutaway(job.taskId, code)
        if (!res.ok) return setError(res.error)
        setPaso('llevar')
        return
      }
      const res = await completePutaway(job.taskId, code)
      if (!res.ok) return setError(res.error)
      setGuardadoEn(res.locationCode)
      setPaso('listo')
    })
  }


  if (paso === 'listo') {
    return (
      <div className="flex flex-col gap-6 text-center">
        <p className="text-sm text-azul/60">Guardado en</p>
        <p className="text-4xl tabular-nums">{guardadoEn}</p>
        <button type="button" onClick={tomar} disabled={pending} className={BOTON}>
          Siguiente tarea
        </button>
      </div>
    )
  }

  if (paso === 'inicio') {
    return (
      <div className="flex flex-col gap-4">
        <button type="button" onClick={tomar} disabled={pending} className={BOTON}>
          {pending ? 'Buscando...' : 'Tomar siguiente tarea'}
        </button>
        {vacio ? <p className="text-center text-azul/60">No hay tareas pendientes.</p> : null}
        {error ? <Aviso>{error}</Aviso> : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl bg-azul-08 p-3">
        <p>{job?.productName}</p>
        <p className="text-sm text-azul/60">
          {job?.sku} · {job?.qty} cajas{job?.lot ? ` · lote ${job.lot}` : ''}
        </p>
      </div>

      {paso === 'tomar' ? (
        <>
          <div className="text-center">
            <p className="text-sm text-azul/60">Ve a</p>
            <p className="text-3xl tabular-nums">{job?.fromCode}</p>
            <p className="mt-4 text-sm text-azul/60">Toma el pallet</p>
            <p className="text-2xl tabular-nums">{job?.lpnCode}</p>
          </div>
          <ScanInput label="Escanea la matrícula del pallet" disabled={pending} onScan={escanear} />
        </>
      ) : (
        <>
          <div className="text-center">
            <p className="text-sm text-azul/60">Llévalo a</p>
            <p className="text-5xl tabular-nums">{job?.toCode ?? 'Elige un hueco'}</p>
          </div>
          <ScanInput
            label="Escanea la posición donde lo dejaste"
            disabled={pending}
            onScan={escanear}
          />
        </>
      )}

      {error ? <Aviso>{error}</Aviso> : null}
    </div>
  )
}
