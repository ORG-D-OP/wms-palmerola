'use client'

import { useState, useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'
import { RackElevation } from '@/components/rack-elevation'
import { WarehouseCanvas } from '@/components/warehouse-canvas'
import { Aviso } from '@/components/ui/feedback'
import { BOTON, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { nivelesDe } from '@/lib/warehouse/plano'
import { claimPick, completePick, startPick, type Pick } from './actions'

type Paso = 'inicio' | 'ir' | 'tomar' | 'listo'

export function PickForm() {
  const [paso, setPaso] = useState<Paso>('inicio')
  const [pick, setPick] = useState<Pick | null>(null)
  const [codigo, setCodigo] = useState<string | null>(null)
  const [surtido, setSurtido] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vacio, setVacio] = useState(false)
  const [pending, startTransition] = useTransition()

  const tomar = () => {
    setError(null)
    setVacio(false)
    setCodigo(null)
    startTransition(async () => {
      const res = await claimPick()
      if (!res.ok) return setError(res.error)
      if (!res.pick) return setVacio(true)
      setPick(res.pick)
      setPaso('ir')
    })
  }

  const escanearPosicion = (code: string) => {
    if (!pick || !code.trim()) return
    setError(null)
    startTransition(async () => {
      const res = await startPick(pick.taskId, code)
      if (!res.ok) return setError(res.error)
      setPaso('tomar')
    })
  }

  const confirmar = (datos: FormData) => {
    if (!pick || !codigo) return
    setError(null)
    startTransition(async () => {
      const res = await completePick(pick.taskId, codigo, Number(datos.get('qty')))
      if (!res.ok) return setError(res.error)
      setSurtido(res.surtido)
      setPaso('listo')
    })
  }

  if (paso === 'listo') {
    return (
      <div className="flex flex-col gap-6 text-center">
        <div>
          <p className="text-sm text-azul/60">Surtido</p>
          <p className="text-3xl tabular-nums">{surtido} cajas</p>
        </div>
        <div>
          <p className="text-sm text-azul/60">Llévalo a</p>
          <p className="text-4xl tabular-nums">{pick?.toCode}</p>
        </div>
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
        <p>{pick?.productName}</p>
        <p className="text-sm text-azul/60">
          {pick?.sku} · {pick?.qty} cajas
          {pick?.lot ? ` · lote ${pick.lot}` : ''}
          {pick?.expiry ? ` · vence ${pick.expiry}` : ''}
        </p>
      </div>

      {paso === 'ir' ? (
        <>
          <div className="text-center">
            <p className="text-sm text-azul/60">Ve a</p>
            <p className="text-5xl tabular-nums">{pick?.fromCode}</p>
          </div>
          {pick?.fromCode ? (
            <RackElevation code={pick.fromCode} niveles={nivelesDe(pick.fromCode)} />
          ) : null}
          {pick?.fromCode ? <WarehouseCanvas ocupacion={{}} destino={pick.fromCode} /> : null}
          <ScanInput
            label="Escanea la posición"
            disabled={pending}
            onScan={escanearPosicion}
          />
        </>
      ) : (
        <>
          {!codigo ? (
            <ScanInput
              label="Escanea el código de la caja"
              disabled={pending}
              onScan={(c) => setCodigo(c.trim())}
            />
          ) : (
            <form action={confirmar} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className={ETIQUETA}>Cajas que tomaste</span>
                <input
                  name="qty"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={pick?.qty}
                  required
                  defaultValue={pick?.qty}
                  className={CAMPO}
                />
              </label>
              <button type="submit" disabled={pending} className={BOTON}>
                {pending ? 'Guardando...' : 'Confirmar'}
              </button>
            </form>
          )}
        </>
      )}

      {error ? <Aviso>{error}</Aviso> : null}
    </div>
  )
}
