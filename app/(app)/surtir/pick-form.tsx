'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'
import { RackFace } from '@/components/rack-face'
import { WarehouseCanvas } from '@/components/warehouse-canvas'
import { Aviso, Logro } from '@/components/ui/feedback'
import { SinTarea } from '@/components/ui/sin-tarea'
import { BOTON, BOTON_SUAVE, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { desglose, textoCajas } from '@/lib/cajas'
import { Icon } from '@/components/ui/icon'
import { claimPick, completePick, startPick, type Pick } from './actions'

type Paso = 'buscando' | 'ir' | 'tomar' | 'sin'

/**
 * Surtir. Dos tareas distintas con la misma forma: llevarse un pallet completo, que es lo
 * más común, o sacar cajas de una posición de picking.
 *
 * El pallet entero se confirma con su matrícula y no se cuenta: romper el emplayado para
 * leer una caja y volver a emplayar es trabajo inventado. Las cajas sueltas sí se cuentan,
 * porque ahí la cantidad es el dato.
 *
 * Igual que guardar, no hay botón para pedir tarea: al entrar cae una, y al terminarla cae
 * la siguiente con el recibo de la anterior arriba.
 */
export function PickForm() {
  const [paso, setPaso] = useState<Paso>('buscando')
  const [pick, setPick] = useState<Pick | null>(null)
  const [verCara, setVerCara] = useState(false)
  const [codigo, setCodigo] = useState<string | null>(null)
  const [recibo, setRecibo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const tomar = useCallback(() => {
    startTransition(async () => {
      setError(null)
      setCodigo(null)
      const res = await claimPick()
      if (!res.ok) {
        setPaso('sin')
        return setError(res.error)
      }
      if (!res.pick) {
        setPick(null)
        return setPaso('sin')
      }
      setPick(res.pick)
      setVerCara(false)
      setPaso('ir')
    })
  }, [])

  useEffect(() => {
    tomar()
  }, [tomar])

  const escanearPosicion = (code: string) => {
    if (!pick || !code.trim()) return
    setError(null)
    startTransition(async () => {
      const res = await startPick(pick.taskId, code)
      if (!res.ok) return setError(res.error)
      setRecibo(null)
      setPaso('tomar')
    })
  }

  const confirmar = (datos: FormData) => {
    if (!pick || !codigo) return
    setError(null)
    const destino = pick.toCode
    startTransition(async () => {
      const res = await completePick(
        pick.taskId,
        codigo,
        Number(datos.get('cajas') ?? 0),
        Number(datos.get('sueltas') ?? 0),
      )
      if (!res.ok) {
        // Sin limpiar el código no hay forma de volver a escanear: la pantalla se pega.
        setCodigo(null)
        return setError(res.error)
      }
      setRecibo(
        pick.palletEntero
          ? `Pallet completo dejado en ${destino}.`
          : `${res.texto} dejadas en ${destino}.`,
      )
      tomar()
    })
  }

  const aviso = recibo ? <Logro>{recibo}</Logro> : null
  const pedido = desglose(pick?.qty ?? 0, pick?.porCaja ?? 1)

  if (paso === 'buscando') {
    return (
      <div className="flex flex-col gap-4">
        {aviso}
        <p className="text-center text-azul/60">Buscando trabajo...</p>
      </div>
    )
  }

  if (paso === 'sin') {
    return (
      <div className="flex flex-col gap-4">
        {aviso}
        <SinTarea texto="No hay nada que surtir ahora." error={error} reintentar={tomar} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {aviso}

      <div className="rounded-xl bg-azul-08 p-3">
        <p>{pick?.productName}</p>
        <p className="text-sm text-azul/60">
          {pick?.sku} · {pick ? textoCajas(pick.qty, pick.porCaja) : ''}
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
            <p className="text-center">Llévate el pallet completo: {pick.lpnCode}</p>
          ) : null}

          {pick?.fromCode ? (
            <div className="flex flex-col gap-3">
              {verCara && pick.cara ? (
                <RackFace cara={pick.cara} destino={pick.fromCode} />
              ) : (
                <WarehouseCanvas ocupacion={{}} destino={pick.fromCode} />
              )}
              {pick.cara ? (
                <button type="button" onClick={() => setVerCara(!verCara)} className={BOTON_SUAVE}>
                  <Icon name={verCara ? 'map' : 'view_in_ar'} />
                  {verCara ? 'Ver el camino' : 'Ya llegué: ver la cara del rack'}
                </button>
              ) : null}
            </div>
          ) : null}

          <ScanInput label="Escanea la posición" disabled={pending} onScan={escanearPosicion} />
        </>
      ) : (
        <>
          <div className="text-center">
            <p className="text-sm text-azul/60">Llévalo a</p>
            <p className="text-3xl tabular-nums">{pick?.toCode}</p>
          </div>

          {!codigo ? (
            <ScanInput
              label={
                pick?.palletEntero
                  ? 'Escanea la matrícula del pallet'
                  : 'Escanea el código de la caja o la matrícula'
              }
              disabled={pending}
              onScan={(c) => setCodigo(c.trim())}
            />
          ) : (
            <form action={confirmar} className="flex flex-col gap-4">
              {pick?.palletEntero ? (
                <>
                  <input type="hidden" name="cajas" value={pedido.cajas} />
                  <input type="hidden" name="sueltas" value={pedido.sueltas} />
                </>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className={ETIQUETA}>Cajas que tomaste</span>
                    <input
                      name="cajas"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      required
                      defaultValue={pedido.cajas}
                      className={CAMPO}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className={ETIQUETA}>Sueltas</span>
                    <input
                      name="sueltas"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      required
                      defaultValue={pedido.sueltas}
                      disabled={(pick?.porCaja ?? 1) <= 1}
                      className={CAMPO}
                    />
                  </label>
                </div>
              )}
              <button type="submit" disabled={pending} className={BOTON}>
                {pending ? 'Guardando...' : pick?.palletEntero ? 'Me llevo el pallet' : 'Confirmar'}
              </button>
            </form>
          )}
        </>
      )}

      {error ? <Aviso>{error}</Aviso> : null}
    </div>
  )
}
