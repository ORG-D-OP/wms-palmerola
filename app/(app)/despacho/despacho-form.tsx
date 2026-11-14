'use client'

import { useState, useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'
import { Aviso, Logro } from '@/components/ui/feedback'
import { Icon } from '@/components/ui/icon'
import { BOTON, BOTON_SUAVE, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { ESTADO } from './estado'
import {
  buscarDespacho,
  chequear,
  corregirCantidad,
  despachar,
  recargarDespacho,
  type Camion,
  type Linea,
} from './actions'
import { plural } from '@/lib/plural'
import { desglose, textoCajas } from '@/lib/cajas'

/**
 * Despachar un camión: la hoja, convertida en lista de chequeo.
 *
 * El escaneo del tabulado abre el camión y reparte el surtido. A partir de ahí la pantalla
 * es la hoja: todas las líneas con su cantidad, y el chequeador va escaneando lo que sube.
 * Lo escaneado queda en verde; lo que no alcanzó la bodega queda señalado como faltante
 * desde el primer momento, sin esperar a que alguien lo descubra en el andén.
 *
 * El escaneo da por buena toda la cantidad que bajó, porque ése es el caso normal, y la deja
 * corregible mientras el camión no haya salido: chequear es comprobar la cantidad, y nadie
 * cuenta bien a la primera con un camión esperando. Lo que el chequeador deje escrito es lo
 * que sale; lo que no subió se queda en el andén.
 *
 * El camión se puede cerrar incompleto, porque un camión que tiene que salir sale, pero eso
 * pide una razón: un faltante que nadie escribió es un descuadre que aparece la semana que
 * viene sin dueño.
 */
export function DespachoForm({ puedeCerrar }: { puedeCerrar: boolean }) {
  const [camion, setCamion] = useState<Camion | null>(null)
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')
  const [cerrandoCorto, setCerrandoCorto] = useState(false)
  const [pending, empezar] = useTransition()

  function resolver(respuesta: Awaited<ReturnType<typeof buscarDespacho>>) {
    if (respuesta.ok) {
      setCamion(respuesta.camion)
      setError('')
    } else {
      setError(respuesta.error)
    }
  }

  if (!camion) {
    return (
      <div className="flex flex-col gap-5">
        <ScanInput
          label="Escanea el código de la hoja de despacho"
          disabled={pending}
          onScan={(codigo) => empezar(async () => resolver(await buscarDespacho(codigo)))}
          formato="transporte"
        />
        <p className="text-sm text-azul/60">
          El código de barras de la hoja es el número de transporte. Si el mismo camión trae
          varias hojas, se abren todas juntas: no importa cuál tengas en la mano. Al
          escanearla se reparte el surtido entre los que estén en el andén.
        </p>
        {error ? <Aviso>{error}</Aviso> : null}
      </div>
    )
  }

  const despachado = camion.estado === 'SHIPPED'
  const chequeadas = camion.detalle.filter((l) => l.chequeada).length
  const faltantes = camion.detalle.filter((l) => l.apartado < l.pedido)
  const completo = chequeadas === camion.detalle.length && camion.pendientes === 0
  /**
   * Y si alguna línea sale por debajo de lo que pedía, el camión va corto aunque esté todo
   * chequeado: es justo lo que pasa cuando el chequeador baja una cantidad. Eso pide razón.
   */
  const corto = camion.detalle.some((l) => (l.arriba ?? l.surtido) < l.pedido)

  const marcar = (codigo: string) =>
    empezar(async () => {
      const res = await chequear(camion.id, codigo)
      if (!res.ok) {
        setAviso('')
        return setError(res.error)
      }
      setCamion(res.camion)
      setAviso(res.aviso)
      setError('')
    })

  const cerrar = (nota?: string) =>
    empezar(async () => {
      const res = await despachar(camion.id, nota)
      if (!res.ok) return setError(res.error)
      setCamion(res.camion)
      setCerrandoCorto(false)
      setAviso('')
      setError('')
    })

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1 rounded-2xl border border-borde p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-lg tabular-nums">{camion.transporte ?? camion.code}</span>
          <span className="shrink-0 rounded-md bg-azul-08 px-2 py-1 text-xs">
            {ESTADO[camion.estado as keyof typeof ESTADO] ?? camion.estado}
          </span>
        </div>
        <p className="text-sm text-azul/60">
          {camion.cliente ?? 'sin cliente'} · {camion.anden ?? 'sin andén'} ·{' '}
          {plural(camion.lineas, 'línea', 'líneas')}
        </p>
        {camion.entregas.length > 0 ? (
          <p className="text-sm text-azul/60">Documentos: {camion.entregas.join(', ')}</p>
        ) : null}
      </div>

      {despachado ? (
        <Logro>El camión salió. No queda nada por hacer con esta hoja.</Logro>
      ) : (
        <>
          <ScanInput
            label="Escanea lo que va subiendo al camión"
            disabled={pending}
            onScan={marcar}
          />
          {aviso ? <Logro>{aviso}</Logro> : null}
        </>
      )}

      <p className="text-sm text-azul/60">
        {chequeadas} de{' '}
        {camion.detalle.length === 1
          ? '1 línea chequeada'
          : `${camion.detalle.length} líneas chequeadas`}
        {faltantes.length > 0 ? ` · ${faltantes.length} sin producto suficiente` : ''}
      </p>

      <ul className="flex flex-col divide-y divide-borde">
        {camion.detalle.map((l) => (
          <Renglon
            key={l.lineNo}
            linea={l}
            editable={!despachado && puedeCerrar}
            onCorregir={(cajas) =>
              empezar(async () => {
                const res = await corregirCantidad(camion.id, l.id, cajas)
                if (!res.ok) return setError(res.error)
                setCamion(res.camion)
                setAviso(`${l.name}: ${textoCajas(cajas * l.porCaja, l.porCaja)} arriba.`)
                setError('')
              })
            }
          />
        ))}
      </ul>

      {!despachado && puedeCerrar ? (
        cerrandoCorto ? (
          <form
            action={(datos) => cerrar(String(datos.get('nota') ?? ''))}
            className="flex flex-col gap-3 rounded-2xl border border-borde p-4"
          >
            <label className="flex flex-col gap-1.5">
              <span className={ETIQUETA}>¿Por qué sale sin todo?</span>
              <input
                name="nota"
                required
                maxLength={200}
                autoFocus
                placeholder="No había producto y el cliente lo recibe así"
                className={CAMPO}
              />
            </label>
            <p className="text-sm text-azul/60">
              Lo que quedó apartado y sin surtir se suelta para otro camión, y la razón queda
              guardada en la hoja.
            </p>
            <button type="submit" disabled={pending} className={BOTON}>
              {pending ? 'Cerrando...' : 'Cerrar el camión así'}
            </button>
            <button type="button" onClick={() => setCerrandoCorto(false)} className={BOTON_SUAVE}>
              Mejor no
            </button>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              disabled={pending || !completo}
              onClick={() => (corto ? setCerrandoCorto(true) : cerrar())}
              className={BOTON}
            >
              {pending ? 'Despachando...' : 'Marcar camión despachado'}
            </button>
            {!completo ? (
              <>
                <p className="text-sm text-azul/60">
                  {camion.pendientes > 0
                    ? camion.pendientes === 1
                      ? 'Queda 1 tarea de surtido abierta.'
                      : `Quedan ${camion.pendientes} tareas de surtido abiertas.`
                    : 'Falta chequear líneas.'}{' '}
                  El camión se cierra cuando esté todo arriba.
                </p>
                <button
                  type="button"
                  onClick={() => setCerrandoCorto(true)}
                  className={BOTON_SUAVE}
                >
                  Cerrarlo igual, sin todo
                </button>
              </>
            ) : corto ? (
              <p className="text-sm text-azul/60">
                Alguna línea sale con menos de lo que pedía. Al cerrarlo hay que decir por qué.
              </p>
            ) : null}
          </div>
        )
      ) : null}

      {!despachado && !puedeCerrar && completo ? (
        <p className="text-sm text-azul/60">
          Ya está todo arriba. El camión lo cierra el chequeador con la hoja en la mano.
        </p>
      ) : null}

      <div className="flex gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => empezar(async () => resolver(await recargarDespacho(camion.id)))}
          className={BOTON_SUAVE}
        >
          <Icon name="refresh" />
          Actualizar
        </button>
        <button
          type="button"
          onClick={() => {
            setCamion(null)
            setError('')
            setAviso('')
          }}
          className={BOTON_SUAVE}
        >
          <Icon name="barcode_scanner" />
          Otro camión
        </button>
      </div>

      {error ? <Aviso>{error}</Aviso> : null}
    </div>
  )
}

/**
 * Una línea de la hoja. Tres estados y se distinguen de un vistazo desde un metro: chequeada
 * en verde, corta de producto en rojo, y pendiente en gris.
 */
function Renglon({
  linea,
  editable,
  onCorregir,
}: {
  linea: Linea
  editable: boolean
  onCorregir: (cajas: number) => void
}) {
  const [corrigiendo, setCorrigiendo] = useState(false)
  const corta = linea.apartado < linea.pedido
  const falta = linea.pedido - linea.apartado
  // Sin corregir nada, lo que sube es todo lo que bajó: el escaneo no congela una cifra,
  // porque una línea casi nunca baja de un solo viaje.
  const arriba = linea.arriba ?? linea.surtido
  const { cajas: cajasArriba } = desglose(arriba, linea.porCaja)
  const deMenos = linea.chequeada && arriba < linea.surtido

  return (
    <li
      className={`-mx-2 flex flex-col gap-2 rounded-xl px-2 py-3 ${
        linea.chequeada ? 'bg-[var(--verde)]/20' : ''
      }`}
    >
      <div className="flex items-center gap-3">
        <Icon
          name={linea.chequeada ? 'check_circle' : corta ? 'error' : 'radio_button_unchecked'}
          className={linea.chequeada ? 'text-azul' : corta ? 'text-rojo' : 'text-azul/30'}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{linea.name}</span>
          <span className="block text-sm text-azul/60">
            {linea.sku}
            {corta ? (
              <span className="text-rojo"> · faltan {textoCajas(falta, linea.porCaja)}</span>
            ) : null}
          </span>
        </span>
        <span className="shrink-0 text-right tabular-nums">
          <span className="block">{textoCajas(linea.pedido, linea.porCaja)}</span>
          <span className="block text-xs text-azul/60">
            {linea.chequeada
              ? `${textoCajas(arriba, linea.porCaja)} arriba`
              : linea.surtido > 0
                ? `${textoCajas(linea.surtido, linea.porCaja)} surtidas`
                : 'sin surtir'}
          </span>
        </span>
      </div>

      {/*
        Corregir la cantidad es parte del oficio: el chequeador cuenta y la hoja dice otra
        cosa. Sólo sale cuando la línea ya está chequeada, porque antes no hay nada que
        corregir, y se va con el camión: despachado, el número ya no se toca.
      */}
      {linea.chequeada && editable ? (
        corrigiendo ? (
          <form
            action={(datos) => {
              onCorregir(Number(datos.get('cajas')))
              setCorrigiendo(false)
            }}
            className="flex items-end gap-2"
          >
            <label className="flex flex-1 flex-col gap-1.5">
              <span className={ETIQUETA}>¿Cuántas cajas subieron?</span>
              <input
                name="cajas"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                defaultValue={cajasArriba}
                autoFocus
                required
                className={CAMPO}
              />
            </label>
            <button type="submit" className={BOTON}>
              Guardar
            </button>
            <button type="button" onClick={() => setCorrigiendo(false)} className={BOTON_SUAVE}>
              Mejor no
            </button>
          </form>
        ) : (
          <div className="flex items-center gap-3 pl-9">
            {deMenos ? (
              <span className="text-sm text-rojo">
                Subieron {textoCajas(linea.surtido - arriba, linea.porCaja)} menos de las que
                bajaron
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setCorrigiendo(true)}
              className="text-sm text-azul/60 underline"
            >
              Corregir la cantidad
            </button>
          </div>
        )
      ) : null}
    </li>
  )
}
