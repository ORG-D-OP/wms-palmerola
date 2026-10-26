'use client'

import { useState, useTransition } from 'react'
import { claimPutaway, completePutaway, startPutaway, type Job } from './actions'

const campo = 'h-14 w-full rounded-lg border border-black/15 px-3 text-lg dark:border-white/20'
const boton = 'h-14 w-full rounded-lg bg-foreground text-lg font-medium text-background disabled:opacity-60'

type Paso = 'inicio' | 'tomar' | 'llevar' | 'listo'

// Fuera del render a proposito: si se declara adentro, React lo recrea en cada
// actualizacion y el campo pierde el foco, que con un escaner es inusable.
function Scan({
  etiqueta,
  disabled,
  onScan,
}: {
  etiqueta: string
  disabled: boolean
  onScan: (code: string) => void
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{etiqueta}</span>
      <input
        autoFocus
        inputMode="none"
        disabled={disabled}
        className={campo}
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
        <p className="text-sm uppercase tracking-wide opacity-60">Guardado en</p>
        <p className="text-4xl font-bold tabular-nums">{guardadoEn}</p>
        <button type="button" onClick={tomar} disabled={pending} className={boton}>
          Siguiente tarea
        </button>
      </div>
    )
  }

  if (paso === 'inicio') {
    return (
      <div className="flex flex-col gap-4">
        <button type="button" onClick={tomar} disabled={pending} className={boton}>
          {pending ? 'Buscando...' : 'Tomar siguiente tarea'}
        </button>
        {vacio ? <p className="text-center opacity-70">No hay tareas pendientes.</p> : null}
        {error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg border border-black/10 p-3 dark:border-white/15">
        <p className="font-medium">{job?.productName}</p>
        <p className="text-sm opacity-60">
          {job?.sku} · {job?.qty} cajas{job?.lot ? ` · lote ${job.lot}` : ''}
        </p>
      </div>

      {paso === 'tomar' ? (
        <>
          <div className="text-center">
            <p className="text-sm uppercase tracking-wide opacity-60">Ve a</p>
            <p className="text-3xl font-bold tabular-nums">{job?.fromCode}</p>
            <p className="mt-3 text-sm uppercase tracking-wide opacity-60">Toma el pallet</p>
            <p className="text-2xl font-semibold tabular-nums">{job?.lpnCode}</p>
          </div>
          <Scan etiqueta="Escanea la matricula del pallet" disabled={pending} onScan={escanear} />
        </>
      ) : (
        <>
          <div className="text-center">
            <p className="text-sm uppercase tracking-wide opacity-60">Llevalo a</p>
            <p className="text-5xl font-bold tabular-nums">{job?.toCode ?? 'Elige un hueco'}</p>
          </div>
          <Scan
            etiqueta="Escanea la posicion donde lo dejaste"
            disabled={pending}
            onScan={escanear}
          />
        </>
      )}

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  )
}
