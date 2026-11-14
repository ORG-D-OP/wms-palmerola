'use client'

import { useState, useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'
import { Aviso } from '@/components/ui/feedback'
import { Icon } from '@/components/ui/icon'
import { BOTON, BOTON_SUAVE, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { Crossdock } from './crossdock'
import { SinAviso } from './sin-aviso'
import {
  abrirSinAviso,
  buscarIngreso,
  cerrarSinAviso,
  corregirRecibo,
  recibirPallet,
  type Documento,
  type Recibido,
} from './actions'
import { plural } from '@/lib/plural'
import { fecha } from '@/lib/fechas'
import { nombrePosicion } from '@/lib/posiciones'

type Dock = { id: string; code: string }

export function IngresoForm({
  docks,
  deAnden,
}: {
  docks: Dock[]
  /**
   * El que manda en el andén: abre un ingreso sin aviso y corrige las cajas que bajaron. El
   * auxiliar sí recibe pallets de un ingreso ya abierto, pero no hace ninguna de esas dos.
   * Sin esto los botones se le ofrecían a quien el servidor iba a rechazar.
   */
  deAnden: boolean
}) {
  const [dockId, setDockId] = useState(docks[0]?.id ?? '')
  const [doc, setDoc] = useState<Documento | null>(null)
  const [ultimo, setUltimo] = useState<Recibido | null>(null)
  const [verLista, setVerLista] = useState(false)
  const [abriendoCiego, setAbriendoCiego] = useState(false)
  const [enCrossdock, setEnCrossdock] = useState(false)
  const [corrigiendo, setCorrigiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const cargar = (pedido: string) =>
    startTransition(async () => {
      const res = await buscarIngreso(pedido)
      if (!res.ok) return setError(res.error)
      setDoc(res.doc)
      setUltimo(null)
    })

  const abrirCiego = (datos: FormData) => {
    setError(null)
    startTransition(async () => {
      const res = await abrirSinAviso({
        origen: String(datos.get('origen') ?? ''),
        nota: String(datos.get('nota') ?? ''),
      })
      if (!res.ok) return setError(res.error)
      setAbriendoCiego(false)
      cargar(res.pedido)
    })
  }

  const cerrarActa = () => {
    if (!doc) return
    setError(null)
    startTransition(async () => {
      const res = await cerrarSinAviso(doc.pedido)
      if (!res.ok) return setError(res.error)
      setDoc(null)
      setUltimo(null)
    })
  }

  /**
   * Las cajas que bajaron de verdad.
   *
   * El escaneo de la matrícula da por buena la cantidad de la hoja, porque el caso normal es
   * que la hoja acierte y el andén no está para teclear. Pero chequear es contar, y cuando no
   * cuadra hace falta decirlo aquí mismo: después el pallet se va a una posición y ya no es un
   * recibo, es un ajuste de inventario.
   */
  const corregir = (cajas: number) => {
    if (!doc || !ultimo?.palletCode) return
    setError(null)
    startTransition(async () => {
      const res = await corregirRecibo({
        pedido: doc.pedido,
        palletCode: ultimo.palletCode!,
        cajas,
      })
      if (!res.ok) return setError(res.error)
      // Sin recargar el documento: `cargar` borra la tarjeta, y es justo lo que el que recibe
      // acaba de corregir y quiere ver. Los pallets recibidos no cambian al corregir cajas.
      setUltimo({ ...ultimo, cases: res.cajas })
      setCorrigiendo(false)
    })
  }

  const escanearPallet = (code: string) => {
    if (!doc || !code.trim()) return
    setError(null)
    startTransition(async () => {
      const res = await recibirPallet({
        pedido: doc.pedido,
        palletCode: code,
        dockLocationId: dockId,
      })
      if (!res.ok) return setError(res.error)
      setUltimo(res.recibido)
      setCorrigiendo(false)
      setDoc({
        ...doc,
        recibidos: res.recibido.recibidos,
        lineas: doc.lineas.map((l) =>
          l.palletCode.toUpperCase() === code.trim().toUpperCase()
            ? { ...l, recibido: true }
            : l,
        ),
      })
    })
  }

  if (!doc) {
    return (
      <div className="flex flex-col gap-5">
        <label className="flex flex-col gap-1.5">
          <span className={ETIQUETA}>Andén de descarga</span>
          <select value={dockId} onChange={(e) => setDockId(e.target.value)} className={CAMPO}>
            {docks.map((d) => (
              <option key={d.id} value={d.id}>
                {nombrePosicion(d.code)}
              </option>
            ))}
          </select>
        </label>

        <ScanInput
          label="Pedido del comprobante de carga"
          disabled={pending}
          onScan={(codigo) => {
            setError(null)
            cargar(codigo)
          }}
          formato="pedido"
        />

        <p className="text-sm text-azul/60">
          Son los ocho dígitos de la página que trae la lista de productos. Se abre una vez por
          camión; después solo se escanean las etiquetas de los pallets.
        </p>

        {deAnden ? (
          <div className="border-t border-borde pt-5">
            {abriendoCiego ? (
              <form action={abrirCiego} className="flex flex-col gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className={ETIQUETA}>¿De dónde viene?</span>
                  <input name="origen" autoFocus placeholder="Planta Choloma" className={CAMPO} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={ETIQUETA}>Nota (opcional)</span>
                  <input name="nota" placeholder="Avisaron por correo" className={CAMPO} />
                </label>
                <button type="submit" disabled={pending} className={BOTON}>
                  {pending ? 'Abriendo...' : 'Empezar a descargar'}
                </button>
                <button
                  type="button"
                  onClick={() => setAbriendoCiego(false)}
                  className={BOTON_SUAVE}
                >
                  Cancelar
                </button>
              </form>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setAbriendoCiego(true)}
                  className={BOTON_SUAVE}
                >
                  Llegó un camión sin aviso
                </button>
                <p className="mt-2 text-sm text-azul/60">
                  Cuando no hay hoja ni pedido. Se abre el ingreso, se recibe lo que baje, y al
                  cerrarlo queda el acta de lo que entró de verdad.
                </p>
              </>
            )}
          </div>
        ) : null}

        {error ? <Aviso>{error}</Aviso> : null}
      </div>
    )
  }

  const faltan = doc.pallets - doc.recibidos
  const pendientes = doc.lineas.filter((l) => !l.recibido)

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl bg-azul-08 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-azul/60">{doc.sinAviso ? 'Ingreso sin aviso' : 'Pedido'}</p>
          <button
            type="button"
            onClick={() => {
              setDoc(null)
              setUltimo(null)
              setError(null)
            }}
            className="text-sm underline underline-offset-4"
          >
            {/*
              Se llamaba «Cerrar», justo al lado de la palabra «Pedido», y no cierra nada: sólo
              quita el documento de la pantalla. El de bodega leía «cerrar el recibo» y se iba
              creyendo que el camión quedaba cerrado, con los pallets que faltaban dentro.
            */}
            Dejarlo para después
          </button>
        </div>
        <p className="text-2xl tabular-nums">{doc.pedido}</p>
        {doc.sinAviso ? (
          <>
            <p className="mt-2 text-sm">
              {doc.pallets} pallets · {doc.materiales} materiales ·{' '}
              {doc.cajas.toLocaleString('es-HN')} cajas
            </p>
            {doc.nota ? <p className="mt-1 text-sm text-azul/60">{doc.nota}</p> : null}
          </>
        ) : (
          <>
            <p className="mt-2 text-sm">
              {doc.recibidos} de {doc.pallets} pallets · {doc.materiales} materiales ·{' '}
              {doc.cajas.toLocaleString('es-HN')} cajas
            </p>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-white"
              role="progressbar"
              aria-valuenow={doc.recibidos}
              aria-valuemax={doc.pallets}
            >
              <div
                className="h-full bg-[var(--verde)] transition-[width]"
                style={{ width: `${doc.pallets ? (doc.recibidos / doc.pallets) * 100 : 0}%` }}
              />
            </div>
          </>
        )}
      </div>

      {ultimo ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-borde p-4 text-center">
          <div>
            <p className="text-sm text-azul/60">{ultimo.sku}</p>
            <p>{ultimo.name}</p>
            <p className="text-sm text-azul/60">{plural(ultimo.cases, 'caja', 'cajas')}</p>
            {deAnden && ultimo.palletCode && !doc.sinAviso ? (
              corrigiendo ? (
                <form
                  action={(datos) => corregir(Number(datos.get('cajas')))}
                  className="mt-3 flex flex-col gap-2 text-left"
                >
                  <label className="flex flex-col gap-1.5">
                    <span className={ETIQUETA}>¿Cuántas cajas bajaron?</span>
                    <input
                      name="cajas"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      required
                      autoFocus
                      defaultValue={ultimo.cases}
                      className={CAMPO}
                    />
                  </label>
                  <button type="submit" disabled={pending} className={BOTON}>
                    {pending ? 'Guardando...' : 'Son estas'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCorrigiendo(false)}
                    className={BOTON_SUAVE}
                  >
                    Mejor no
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setCorrigiendo(true)}
                  className="mt-1 text-sm underline underline-offset-4"
                >
                  No son {plural(ultimo.cases, 'caja', 'cajas')}
                </button>
              )
            ) : null}
          </div>
          {/*
            Aquí no dice «llévalo»: el que recibe no se mueve del andén. Ve bajar el producto,
            lo chequea y dice si pasa; el viaje de guardarlo le cae a un auxiliar o a un
            montacarguista, que lo toma de la cola en «Guardar». La posición se enseña porque
            es lo que el sistema ya reservó para ese pallet, no porque sea una orden para él.
          */}
          <div>
            <p className="text-sm text-azul/60">Queda para</p>
            <p className="text-4xl tabular-nums">
              {ultimo.locationCode ? nombrePosicion(ultimo.locationCode) : 'Sin hueco libre'}
            </p>
            <p className="mt-1 text-sm text-azul/60">
              {ultimo.locationCode
                ? 'Lo guarda quien tome la tarea.'
                : 'Avisa al jefe: no hay hueco libre para este producto.'}
            </p>
          </div>
        </div>
      ) : null}

      {ultimo ? (
        <Crossdock
          key={ultimo.lpnCode}
          lpnCode={ultimo.lpnCode}
          onEsperandoAnden={setEnCrossdock}
        />
      ) : null}

      {doc.sinAviso ? (
        <>
          <SinAviso
            pedido={doc.pedido}
            dockLocationId={dockId}
            onRecibido={(recibido) => {
              setUltimo(recibido)
              cargar(doc.pedido)
            }}
            onRecargar={() => cargar(doc.pedido)}
          />
          {deAnden ? (
            <button type="button" onClick={cerrarActa} disabled={pending} className={BOTON_SUAVE}>
              Terminé de descargar: cerrar el acta
            </button>
          ) : (
            <p className="text-sm text-azul/60">
              Cuando termines de bajar todo, el acta la cierra un chequeador.
            </p>
          )}
        </>
      ) : enCrossdock ? null : faltan > 0 ? (
        <ScanInput
          label="Escanea la etiqueta del pallet"
          disabled={pending}
          onScan={escanearPallet}
        />
      ) : (
        <div className="flex flex-col gap-3 rounded-2xl bg-[var(--verde)]/20 p-4 text-center">
          <p className="text-lg">Camión completo</p>
          <p className="text-sm text-azul/70">
            Los {doc.pallets} pallets del pedido {doc.pedido} están recibidos.
          </p>
          <button
            type="button"
            onClick={() => {
              setDoc(null)
              setUltimo(null)
            }}
            className={BOTON_SUAVE}
          >
            Abrir otro pedido
          </button>
        </div>
      )}

      {error ? <Aviso>{error}</Aviso> : null}

      {pendientes.length > 0 ? (
        <section className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setVerLista(!verLista)}
            className="flex items-center gap-1.5 text-sm underline underline-offset-4"
          >
            <Icon name={verLista ? 'expand_less' : 'expand_more'} className="!text-[18px]" />
            {verLista ? 'Ocultar' : `Ver los ${pendientes.length} pallets que faltan`}
          </button>

          {verLista ? (
            <ul className="flex flex-col divide-y divide-borde text-sm">
              {pendientes.map((l) => (
                <li key={l.palletCode} className="flex items-baseline gap-3 py-2">
                  <span className="w-28 shrink-0 font-mono tabular-nums">{l.palletCode}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{l.name}</span>
                    <span className="block text-xs text-azul/60">
                      {l.sku} · {plural(l.cases, 'caja', 'cajas')}
                      {l.lot ? ` · lote ${l.lot}` : ''}
                      {l.expiry ? ` · vence ${fecha(l.expiry)}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
