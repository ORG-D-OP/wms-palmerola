'use client'

import { useState, useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'
import { RackFace } from '@/components/rack-face'
import { WarehouseCanvas } from '@/components/warehouse-canvas'
import { Aviso } from '@/components/ui/feedback'
import { BOTON, BOTON_SUAVE, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { Icon } from '@/components/ui/icon'
import { claimPick, completePick, startPick, type Pick } from './actions'

type Paso = 'inicio' | 'ir' | 'tomar' | 'listo'

/**
 * Surtir. Dos tareas distintas con la misma forma: llevarse un pallet completo, que es lo
 * más común, o sacar cajas de una posición de picking.
 *
 * El pallet entero se confirma con su matrícula y no se cuenta: romper el emplayado para
 * leer una caja y volver a emplayar es trabajo inventado. Las cajas sueltas sí se cuentan,
 * porque ahí la cantidad es el dato.
 */
export function PickForm() {
  const [paso, setPaso] = useState<Paso>('inicio')
  const [pick, setPick] = useState<Pick | null>(null)
  const [verCara, setVerCara] = useState(false)
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
      setVerCara(false)
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
          <p className="text-3xl tabular-nums">
            {pick?.palletEntero ? 'El pallet completo' : `${surtido} cajas`}
          </p>
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
          {pick?.palletEntero ? (
            <p className="text-center">
              Llévate el pallet completo: {pick.lpnCode}
            </p>
          ) : null}

          {verCara && pick?.cara ? (
            <div className="flex flex-col gap-3">
              <RackFace cara={pick.cara} destino={pick.fromCode ?? undefined} />
              <button type="button" onClick={() => setVerCara(false)} className={BOTON_SUAVE}>
                <Icon name="map" />
                Ver el plano
              </button>
            </div>
          ) : pick?.fromCode ? (
            <div className="flex flex-col gap-2">
              <WarehouseCanvas
                ocupacion={{}}
                destino={pick.fromCode}
                onTocar={(t) => {
                  if (pick.cara && pick.fromCode?.startsWith(t.bloque)) setVerCara(true)
                }}
              />
              {pick.cara ? (
                <p className="text-sm text-azul/60">
                  Cuando llegues al rack, tócalo en el plano: se abre la cara con la posición
                  marcada.
                </p>
              ) : null}
            </div>
          ) : null}

          <ScanInput label="Escanea la posición" disabled={pending} onScan={escanearPosicion} />
        </>
      ) : (
        <>
          {!codigo ? (
            <ScanInput
              label={
                pick?.palletEntero
                  ? 'Escanea la matrícula del pallet'
                  : 'Escanea el código de la caja'
              }
              disabled={pending}
              onScan={(c) => setCodigo(c.trim())}
            />
          ) : (
            <form action={confirmar} className="flex flex-col gap-4">
              {pick?.palletEntero ? (
                <input type="hidden" name="qty" value={pick.qty} />
              ) : (
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
              )}
              <button type="submit" disabled={pending} className={BOTON}>
                {pending
                  ? 'Guardando...'
                  : pick?.palletEntero
                    ? 'Me llevo el pallet'
                    : 'Confirmar'}
              </button>
            </form>
          )}
        </>
      )}

      {error ? <Aviso>{error}</Aviso> : null}
    </div>
  )
}
