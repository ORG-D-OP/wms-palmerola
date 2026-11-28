'use client'

import { useState, useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'
import { Aviso } from '@/components/ui/feedback'
import { Icon } from '@/components/ui/icon'
import { BOTON, BOTON_SUAVE, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { SinAviso } from './sin-aviso'
import { FaltaDecirQueEs } from './clase'
import {
  abrirSinAviso,
  buscarIngreso,
  cerrarIngreso,
  corregirRecibo,
  recibirPallet,
  type Documento,
  type Recibido,
} from './actions'
import { cambiarAnden } from '../turno/actions'
import { plural } from '@/lib/plural'
import { fecha } from '@/lib/fechas'
import { nombrePosicion } from '@/lib/posiciones'

type Dock = { id: string; code: string }

/** Un camión que está abierto ahora mismo, de quien sea. */
export type Abierto = {
  pedido: string
  anden: string | null
  pallets: number
  recibidos: number
  sinAviso: boolean
}

export function IngresoForm({
  docks,
  anden,
  abierto,
  abiertos,
  deAnden,
}: {
  docks: Dock[]
  /**
   * El andén declarado del turno, o nulo si trabaja en toda la bodega. Viene puesto cuando lo
   * hay, y cuando no, la pantalla pregunta: no se adivina ninguno.
   */
  anden: string | null
  /** El camión que se está descargando en su andén, traído ya por el servidor. */
  abierto: Documento | null
  /**
   * Los que están a medias en toda la bodega. La pantalla enseña **los del andén que tiene
   * puesto**: el camión es del andén, así que el que se para ahí retoma lo que haya, lo
   * hubiera abierto él o el compañero que se fue a almorzar.
   */
  abiertos: Abierto[]
  /**
   * El que manda en el andén: abre un ingreso sin aviso y corrige las cajas que bajaron. El
   * auxiliar sí recibe pallets de un ingreso ya abierto, pero no hace ninguna de esas dos.
   * Sin esto los botones se le ofrecían a quien el servidor iba a rechazar.
   */
  deAnden: boolean
}) {
  /**
   * El andén de descarga. Nace con el declarado del turno y **nada más**: el `docks[0]` que
   * había antes mandó al `AND-09` los nueve ingresos con andén que hay en la base, porque es
   * el primero de la lista y nadie lo tocaba. Quien trabaja en toda la bodega escoge, y hasta
   * entonces la pantalla no deja escanear.
   */
  const [dockId, setDockId] = useState(docks.find((d) => d.code === anden)?.id ?? '')
  const [movido, setMovido] = useState<{ anden: string; liberadas: number } | null>(null)
  const [doc, setDoc] = useState<Documento | null>(abierto)
  const [ultimo, setUltimo] = useState<Recibido | null>(null)
  const [verLista, setVerLista] = useState(false)
  const [abriendoCiego, setAbriendoCiego] = useState(false)
  const [corrigiendo, setCorrigiendo] = useState(false)
  const [cerrandoCorto, setCerrandoCorto] = useState(false)
  // La transición es una sola para la pantalla entera: sin esto el botón de cerrar pone
  // «Cerrando...» mientras lo que se está escaneando es un pallet.
  const [cerrando, setCerrando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const dock = docks.find((d) => d.id === dockId) ?? null

  // Los camiones de este andén y de ningún otro: el camión es del andén, no de quien lo abrió.
  const delAnden = dock ? abiertos.filter((a) => a.anden === dock.code) : []

  /**
   * Pararse en el andén que se acaba de escoger.
   *
   * Se ofrece, nunca se hace callando: el andén del turno decide qué cola le da trabajo, y
   * meterle a alguien un filtro que no pidió es peor que no moverlo. La base se niega si anda
   * con una tarea empezada, y eso también se enseña.
   */
  const pasarme = () => {
    if (!dock) return
    setError(null)
    startTransition(async () => {
      const res = await cambiarAnden(dock.code)
      if (!res.ok) return setError(res.error)
      setMovido({ anden: dock.code, liberadas: res.liberadas })
    })
  }

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

  /**
   * Cerrar el acta. Con razón escrita cierra el camión que llegó corto.
   *
   * Sin la razón la base no deja cerrar un camión al que le falta lista, y está bien: eso
   * protege del cierre por accidente del que todavía está descargando.
   */
  const cerrarActa = (razon?: string) => {
    if (!doc) return
    setError(null)
    startTransition(async () => {
      setCerrando(true)
      const res = await cerrarIngreso(doc.pedido, razon)
      setCerrando(false)
      if (!res.ok) return setError(res.error)
      setCerrandoCorto(false)
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
            ? { ...l, recibido: true, destino: res.recibido.locationCode }
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
          <select
            value={dockId}
            onChange={(e) => {
              setDockId(e.target.value)
              setMovido(null)
              setError(null)
            }}
            className={CAMPO}
          >
            <option value="">Escoge el andén</option>
            {docks.map((d) => (
              <option key={d.id} value={d.id}>
                {nombrePosicion(d.code)}
              </option>
            ))}
          </select>
        </label>

        {/*
          Escoger andén aquí no mueve a nadie: se lo ofrece. El andén del turno decide qué cola
          le da trabajo, así que pasarlo sin preguntar le metería un filtro que no pidió.
        */}
        {dock && dock.code !== anden && movido?.anden !== dock.code ? (
          <div className="flex flex-col gap-2 rounded-xl bg-celeste/15 p-3 text-sm">
            <p>
              {anden
                ? `Tu turno está en ${nombrePosicion(anden)}.`
                : 'Trabajas en toda la bodega, así que te cae trabajo de todos los andenes.'}{' '}
              ¿Te paso a {nombrePosicion(dock.code)}? Desde ahí te caerían solo sus tareas.
            </p>
            <button
              type="button"
              onClick={pasarme}
              disabled={pending}
              className={`${BOTON_SUAVE} self-start`}
            >
              {pending ? 'Pasando...' : `Sí, pásame a ${nombrePosicion(dock.code)}`}
            </button>
          </div>
        ) : null}

        {movido ? (
          <p className="text-sm text-azul/60">
            Estás en {nombrePosicion(movido.anden)}.
            {movido.liberadas > 0
              ? ` ${plural(movido.liberadas, 'tarea', 'tareas')} sin empezar ${
                  movido.liberadas === 1 ? 'volvió' : 'volvieron'
                } a la cola del andén que dejaste.`
              : ''}
          </p>
        ) : null}

        <ScanInput
          label="Pedido del comprobante de carga"
          disabled={pending || !dock}
          onScan={(codigo) => {
            setError(null)
            cargar(codigo)
          }}
          formato="pedido"
        />

        <p className="text-sm text-azul/60">
          {dock
            ? 'Son los ocho dígitos de la página que trae la lista de productos. Se abre una vez por camión; después solo se escanean las etiquetas de los pallets.'
            : 'Escoge primero el andén donde estás parado: es donde va a quedar el producto que baje.'}
        </p>

        {/*
          Los de este andén y de ningún otro. Un andén aguanta varios camiones abiertos a la
          vez y eso no se avisa ni se impide: se vacía uno, queda producto por guardar y ya hay
          otro en la puerta. Lo que hace falta es poder moverse entre ellos sin cerrar ninguno.
        */}
        {delAnden.length > 0 ? (
          <section className="flex flex-col gap-2 border-t border-borde pt-5">
            <span className={ETIQUETA}>
              Camiones a medio descargar en {nombrePosicion(dock!.code)}
            </span>

            <ul className="flex flex-col divide-y divide-borde">
              {delAnden.map((a) => (
                <li key={a.pedido}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setError(null)
                      cargar(a.pedido)
                    }}
                    className="flex w-full items-baseline gap-3 py-2 text-left"
                  >
                    <span className="font-mono tabular-nums">{a.pedido}</span>
                    <span className="min-w-0 flex-1 text-xs text-azul/60">
                      {a.sinAviso
                        ? `${plural(a.recibidos, 'pallet bajado', 'pallets bajados')}, sin lista`
                        : `${a.recibidos} de ${a.pallets} bajados`}
                    </span>
                    <Icon name="chevron_right" className="!text-[18px] shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

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
                  disabled={!dock}
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
  // SAP anunció el camión pero nadie mandó las etiquetas: hay lista de qué, no de cuáles.
  const anunciado = doc.esperado.length > 0
  const cajasEsperadas = doc.esperado.reduce((n, l) => n + l.cases, 0)
  // Las etiquetas mandan, porque son lo que viene en el camión; pero si SAP dice otra cosa,
  // el que cuenta tiene que saberlo antes de contar.
  const descuadre = doc.pallets > 0 && doc.cajasSap !== null && doc.cajasSap !== doc.cajas

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl bg-azul-08 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-azul/60">
            {!doc.sinAviso || anunciado ? 'Pedido' : 'Ingreso sin aviso'}
          </p>
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

              Tampoco «dejarlo para después»: el camión a medio descargar vuelve solo al entrar
              a la pantalla, así que lo único que hace este botón es despejar para escanear el
              siguiente.
            */}
            Escanear otro pedido
          </button>
        </div>
        <p className="text-2xl tabular-nums">{doc.pedido}</p>
        {doc.sinAviso ? (
          <>
            <p className="mt-2 text-sm">
              {anunciado ? (
                <>
                  SAP anuncia {plural(doc.esperado.length, 'material', 'materiales')} ·{' '}
                  {plural(cajasEsperadas, 'caja', 'cajas')} · sin etiquetas de pallet
                </>
              ) : (
                <>
                  {plural(doc.pallets, 'pallet', 'pallets')} ·{' '}
                  {plural(doc.materiales, 'material', 'materiales')} ·{' '}
                  {plural(doc.cajas, 'caja', 'cajas')}
                </>
              )}
            </p>
            {doc.nota ? <p className="mt-1 text-sm text-azul/60">{doc.nota}</p> : null}
          </>
        ) : (
          <>
            <p className="mt-2 text-sm">
              {doc.recibidos} de {plural(doc.pallets, 'pallet', 'pallets')} ·{' '}
              {plural(doc.materiales, 'material', 'materiales')} ·{' '}
              {plural(doc.cajas, 'caja', 'cajas')}
              {doc.anden ? ` · ${nombrePosicion(doc.anden)}` : ''}
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
            {descuadre ? (
              <p className="mt-2 text-sm text-azul/60">
                SAP dice {doc.cajasSap!.toLocaleString('es-HN')} cajas y las etiquetas suman{' '}
                {doc.cajas.toLocaleString('es-HN')}. Cuenta con cuidado: manda lo que baje.
              </p>
            ) : null}
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

      {doc.sinClase.length > 0 ? (
        <FaltaDecirQueEs productos={doc.sinClase} onHecho={() => cargar(doc.pedido)} />
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
          {anunciado ? (
            <section className="flex flex-col gap-2">
              <p className="text-sm text-azul/60">Lo que SAP dice que trae</p>
              <ul className="flex flex-col divide-y divide-borde text-sm">
                {doc.esperado.map((l) => (
                  <li key={l.sku} className="flex items-baseline gap-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{l.name}</span>
                      <span className="block text-xs text-azul/60">{l.sku}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {l.cases.toLocaleString('es-HN')} cajas
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {deAnden ? (
            <button
              type="button"
              onClick={() => cerrarActa()}
              disabled={pending}
              className={BOTON_SUAVE}
            >
              Terminé de descargar: cerrar el acta
            </button>
          ) : (
            <p className="text-sm text-azul/60">
              Cuando termines de bajar todo, el acta la cierra un chequeador.
            </p>
          )}
        </>
      ) : faltan > 0 ? (
        <>
          <ScanInput
            label="Escanea la etiqueta del pallet"
            disabled={pending}
            onScan={escanearPallet}
          />

          {/*
            El camión corto. Hasta aquí la pantalla sólo ofrecía «Dejarlo para después», así
            que un camión al que le faltó producto se quedaba abierto para siempre: el cierre
            automático llega cuando entra el último pallet, y el último no iba a entrar.
            Igual que el despacho incompleto, se cierra diciendo por qué.
          */}
          {deAnden ? (
            cerrandoCorto ? (
              <form
                action={(datos) => cerrarActa(String(datos.get('razon') ?? ''))}
                className="flex flex-col gap-3 rounded-2xl border border-borde p-4"
              >
                <label className="flex flex-col gap-1.5">
                  <span className={ETIQUETA}>
                    ¿Por qué no bajaron {plural(faltan, 'pallet', 'pallets')}?
                  </span>
                  <input
                    name="razon"
                    required
                    autoFocus
                    maxLength={200}
                    placeholder="No venían en el camión"
                    className={CAMPO}
                  />
                </label>
                <p className="text-sm text-azul/60">
                  Quedan marcados como no llegados, con tu razón, y el camión cerrado.
                </p>
                <button type="submit" disabled={pending} className={BOTON}>
                  {cerrando ? 'Cerrando...' : 'Cerrar el camión'}
                </button>
                <button
                  type="button"
                  onClick={() => setCerrandoCorto(false)}
                  className={BOTON_SUAVE}
                >
                  Mejor no
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setCerrandoCorto(true)}
                disabled={pending}
                className={BOTON_SUAVE}
              >
                El camión llegó corto: cerrarlo
              </button>
            )
          ) : (
            <p className="text-sm text-azul/60">
              Si el camión llegó corto, o si una tarima no trae las cajas que dice el papel,
              eso lo arregla el chequeador del andén: avísale antes de irte.
            </p>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-3 rounded-2xl bg-[var(--verde)]/20 p-4 text-center">
          <p className="text-lg">Camión completo</p>
          <p className="text-sm text-azul/70">
            {doc.pallets === 1 ? 'El' : 'Los'} {plural(doc.pallets, 'pallet', 'pallets')} del pedido{' '}
            {doc.pedido} {doc.pallets === 1 ? 'está recibido' : 'están recibidos'}.
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

      {/*
        La lista entera, no sólo lo que falta: el chequeador necesita ver dónde quedó cada
        pallet que ya pasó para poder preguntar de dónde lo trajeron y comprobar si es cierto.
      */}
      {doc.lineas.length > 0 ? (
        <section className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setVerLista(!verLista)}
            className="flex items-center gap-1.5 text-sm underline underline-offset-4"
          >
            <Icon name={verLista ? 'expand_less' : 'expand_more'} className="!text-[18px]" />
            {verLista
              ? 'Ocultar la lista'
              : pendientes.length > 0
                ? `Ver la lista: ${pendientes.length} sin bajar`
                : 'Ver la lista del camión'}
          </button>

          {verLista ? (
            <ul className="flex flex-col divide-y divide-borde text-sm">
              {doc.lineas.map((l) => (
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
                  <span className="shrink-0 text-right">
                    {!l.recibido ? (
                      <span className="text-azul/40">sin bajar</span>
                    ) : l.destino ? (
                      <span className="tabular-nums">{nombrePosicion(l.destino)}</span>
                    ) : (
                      <span className="text-azul/40">bajado</span>
                    )}
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
