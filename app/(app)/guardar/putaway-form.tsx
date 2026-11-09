'use client'

import { useState, useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'
import { WarehouseCanvas } from '@/components/warehouse-canvas'
import { RackFace } from '@/components/rack-face'
import { Aviso } from '@/components/ui/feedback'
import { BOTON, BOTON_SUAVE } from '@/components/ui/campos'
import { Icon } from '@/components/ui/icon'
import { claimPutaway, completePutaway, startPutaway, type Job } from './actions'

type Paso = 'inicio' | 'tomar' | 'llevar' | 'listo'

/**
 * Guardar un pallet: tomarlo del andén y llevarlo al hueco que el sistema escogió.
 *
 * Dos vistas, un botón para cambiar entre ellas, porque son dos momentos distintos: el plano
 * de planta es el camino —un mapa, dice por dónde ir— y la cara del rack es la llegada, que
 * es lo único que dice en cuál de los seis niveles va, porque desde arriba los seis niveles
 * son un solo cuadro. El botón y no un toque sobre el plano: en un teléfono esos cuadros son
 * de dos milímetros.
 */
export function PutawayForm() {
  const [paso, setPaso] = useState<Paso>('inicio')
  const [job, setJob] = useState<Job | null>(null)
  const [verCara, setVerCara] = useState(false)
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
      setVerCara(false)
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

          {job?.toCode ? (
            <div className="flex flex-col gap-3">
              {verCara && job.cara ? (
                <RackFace cara={job.cara} destino={job.toCode} />
              ) : (
                <WarehouseCanvas
                  ocupacion={{}}
                  origen={job.fromCode ?? undefined}
                  destino={job.toCode}
                />
              )}
              {job.cara ? (
                <button
                  type="button"
                  onClick={() => setVerCara(!verCara)}
                  className={BOTON_SUAVE}
                >
                  <Icon name={verCara ? 'map' : 'view_in_ar'} />
                  {verCara ? 'Ver el camino' : 'Ya llegué: ver la cara del rack'}
                </button>
              ) : null}
            </div>
          ) : null}

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
