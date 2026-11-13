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
  despachar,
  recargarDespacho,
  type Camion,
  type Linea,
} from './actions'
import { plural } from '@/lib/plural'
import { textoCajas } from '@/lib/cajas'

/**
 * Despachar un camión: la hoja, convertida en lista de chequeo.
 *
 * El escaneo del tabulado abre el camión y reparte el surtido. A partir de ahí la pantalla
 * es la hoja: todas las líneas con su cantidad, y el chequeador va escaneando lo que sube.
 * Lo escaneado queda en verde; lo que no alcanzó la bodega queda señalado como faltante
 * desde el primer momento, sin esperar a que alguien lo descubra en el andén.
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
        {chequeadas} de {plural(camion.detalle.length, 'línea', 'líneas')} chequeadas
        {faltantes.length > 0 ? ` · ${faltantes.length} sin producto suficiente` : ''}
      </p>

      <ul className="flex flex-col divide-y divide-borde">
        {camion.detalle.map((l) => (
          <Renglon key={l.lineNo} linea={l} />
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
              onClick={() => cerrar()}
              className={BOTON}
            >
              {pending ? 'Despachando...' : 'Marcar camión despachado'}
            </button>
            {!completo ? (
              <>
                <p className="text-sm text-azul/60">
                  {camion.pendientes > 0
                    ? `Quedan ${plural(camion.pendientes, 'tarea', 'tareas')} de surtido ${
                        camion.pendientes === 1 ? 'abierta' : 'abiertas'
                      }.`
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
function Renglon({ linea }: { linea: Linea }) {
  const corta = linea.apartado < linea.pedido
  const falta = linea.pedido - linea.apartado

  return (
    <li
      className={`-mx-2 flex items-center gap-3 rounded-xl px-2 py-3 ${
        linea.chequeada ? 'bg-[var(--verde)]/20' : ''
      }`}
    >
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
          {textoCajas(linea.surtido, linea.porCaja)} surtidas
        </span>
      </span>
    </li>
  )
}
