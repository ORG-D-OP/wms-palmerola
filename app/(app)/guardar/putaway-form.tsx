'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'
import { WarehouseCanvas } from '@/components/warehouse-canvas'
import { RackFace } from '@/components/rack-face'
import { Aviso, Logro } from '@/components/ui/feedback'
import { SinTarea } from '@/components/ui/sin-tarea'
import { BOTON_SUAVE } from '@/components/ui/campos'
import { Icon } from '@/components/ui/icon'
import {
  buscarHueco,
  cerrarGuardado,
  claimPutaway,
  completePutaway,
  startPutaway,
  type Job,
} from './actions'
import { CAMPO, ETIQUETA } from '@/components/ui/campos'
import { textoCajas } from '@/lib/cajas'
import { nombrePosicion } from '@/lib/posiciones'

type Paso = 'buscando' | 'tomar' | 'llevar' | 'sin'

/**
 * Guardar un pallet: tomarlo del andén y llevarlo al hueco que el sistema escogió.
 *
 * No hay botón para pedir trabajo. Quien entró a trabajo y está parado en un andén ya dijo
 * todo lo que había que decir: al abrir la pantalla le cae la tarea, y al terminar una le
 * cae la siguiente. Lo anterior queda arriba como recibo y no como pantalla aparte, porque
 * parar al operario para que lea algo que ya sabe y apriete «siguiente» es tiempo de bodega.
 *
 * Dos vistas, un botón para cambiar entre ellas, porque son dos momentos distintos: el plano
 * de planta es el camino —un mapa, dice por dónde ir— y la cara del rack es la llegada, que
 * es lo único que dice en cuál de los seis niveles va, porque desde arriba los seis niveles
 * son un solo cuadro. El botón y no un toque sobre el plano: en un teléfono esos cuadros son
 * de dos milímetros.
 */
export function PutawayForm({ puedeCerrar }: { puedeCerrar: boolean }) {
  const [paso, setPaso] = useState<Paso>('buscando')
  const [job, setJob] = useState<Job | null>(null)
  const [verCara, setVerCara] = useState(false)
  const [guardadoEn, setGuardadoEn] = useState<string | null>(null)
  const [cerrando, setCerrando] = useState(false)
  const [razon, setRazon] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Por qué no hay nada: casi nunca es que la bodega esté al día. Ver `porQueNoHayNada`.
  const [motivo, setMotivo] = useState('No hay nada que guardar ahora.')
  const [pending, startTransition] = useTransition()

  const tomar = useCallback(() => {
    startTransition(async () => {
      setError(null)
      const res = await claimPutaway()
      if (!res.ok) {
        setPaso('sin')
        return setError(res.error)
      }
      if (!res.job) {
        setJob(null)
        if (res.motivo) setMotivo(res.motivo)
        return setPaso('sin')
      }
      setJob(res.job)
      setVerCara(false)
      setPaso(res.job.empezada ? 'llevar' : 'tomar')
    })
  }, [])

  useEffect(() => {
    tomar()
  }, [tomar])

  const escanear = (code: string) => {
    if (!job || !code.trim()) return
    setError(null)
    startTransition(async () => {
      if (paso === 'tomar') {
        const res = await startPutaway(job.taskId, code)
        if (!res.ok) return setError(res.error)
        setGuardadoEn(null)
        setPaso('llevar')
        return
      }
      const res = await completePutaway(job.taskId, code)
      if (!res.ok) return setError(res.error)
      setGuardadoEn(res.locationCode)
      tomar()
    })
  }

  const otroHueco = () => {
    if (!job) return
    setError(null)
    startTransition(async () => {
      const res = await buscarHueco(job.taskId)
      if (!res.ok) return setError(res.error)
      setJob({ ...job, toCode: res.code, cara: res.cara })
      setVerCara(false)
    })
  }

  const cerrar = () => {
    if (!job) return
    setError(null)
    startTransition(async () => {
      const res = await cerrarGuardado({ taskId: job.taskId, razon })
      if (!res.ok) return setError(res.error)
      setCerrando(false)
      setRazon('')
      setGuardadoEn(null)
      tomar()
    })
  }

  const recibo = guardadoEn ? <Logro>Guardado en {guardadoEn}.</Logro> : null

  if (paso === 'buscando') {
    return (
      <div className="flex flex-col gap-4">
        {recibo}
        <p className="text-center text-azul/60">Buscando trabajo...</p>
      </div>
    )
  }

  if (paso === 'sin') {
    return (
      <div className="flex flex-col gap-4">
        {recibo}
        <SinTarea texto={motivo} error={error} reintentar={tomar} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {recibo}

      <div className="rounded-xl bg-azul-08 p-3">
        <p>{job?.productName}</p>
        <p className="text-sm text-azul/60">
          {job?.sku} · {job ? textoCajas(job.qty, job.porCaja) : ''}
          {job?.lot ? ` · lote ${job.lot}` : ''}
        </p>
      </div>

      {paso === 'tomar' ? (
        <>
          <div className="text-center">
            <p className="text-sm text-azul/60">Ve a</p>
            <p className="text-3xl tabular-nums">{nombrePosicion(job?.fromCode)}</p>
            <p className="mt-4 text-sm text-azul/60">Toma el pallet</p>
            <p className="text-2xl tabular-nums">{job?.lpnCode}</p>
          </div>
          <ScanInput label="Escanea la matrícula del pallet" disabled={pending} onScan={escanear} />
        </>
      ) : (
        <>
          <div className="text-center">
            <p className="text-sm text-azul/60">Llévalo a</p>
            <p className="text-5xl tabular-nums">
              {job?.toCode ? nombrePosicion(job.toCode) : 'Elige un hueco'}
            </p>
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
                <button type="button" onClick={() => setVerCara(!verCara)} className={BOTON_SUAVE}>
                  <Icon name={verCara ? 'map' : 'view_in_ar'} />
                  {verCara ? 'Ver el camino' : 'Ya llegué: ver la cara del rack'}
                </button>
              ) : null}
            </div>
          ) : (
            /*
              Sin destino la pantalla era un campo de escaneo a secas: ni mapa, ni cara del
              rack, ni candidatos. Pasa cuando al recibir no había un hueco libre, y el motor
              sólo se llamaba al recibir, así que la tarea se quedaba así para siempre. Ahora
              se le vuelve a preguntar, que es lo que la persona haría de todos modos.
            */
            <div className="flex flex-col gap-3">
              <p className="text-sm text-azul/60">
                Cuando se recibió no había hueco libre para este producto. Pregúntale otra vez:
                puede que ya se haya liberado uno.
              </p>
              <button type="button" onClick={otroHueco} disabled={pending} className={BOTON_SUAVE}>
                <Icon name="search" />
                Buscar hueco otra vez
              </button>
            </div>
          )}

          <ScanInput
            label="Escanea la posición donde lo dejaste"
            disabled={pending}
            onScan={escanear}
          />

          {/*
            El callejón sin salida: un químico que entra cuando no queda un hueco de su grupo.
            Guardarlo donde hay alimento se niega, y con razón, así que la tarea no se puede
            cumplir. El jefe la cierra diciendo por qué y el pallet se queda en el andén, con
            su saldo y a la vista; cuando haya hueco se saca con Reordenar.
          */}
          {puedeCerrar ? (
            cerrando ? (
              <div className="flex flex-col gap-2 rounded-2xl border border-borde p-4">
                <label className={ETIQUETA} htmlFor="razon-guardado">
                  Por qué este pallet no se va a guardar
                </label>
                <input
                  id="razon-guardado"
                  className={CAMPO}
                  value={razon}
                  onChange={(e) => setRazon(e.target.value)}
                  placeholder="No hay hueco de su grupo"
                />
                <button type="button" onClick={cerrar} disabled={pending} className={BOTON_SUAVE}>
                  Cerrar la tarea y dejarlo donde está
                </button>
                <button
                  type="button"
                  onClick={() => setCerrando(false)}
                  className="text-sm text-azul/60 underline underline-offset-4"
                >
                  Mejor no
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCerrando(true)}
                className="text-sm text-azul/60 underline underline-offset-4"
              >
                Este pallet no se puede guardar
              </button>
            )
          ) : null}
        </>
      )}

      {error ? <Aviso>{error}</Aviso> : null}
    </div>
  )
}
