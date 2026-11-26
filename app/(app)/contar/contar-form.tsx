'use client'

import { useState, useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'
import { Aviso, Logro } from '@/components/ui/feedback'
import { BOTON, BOTON_SUAVE, CAMPO, ETIQUETA } from '@/components/ui/campos'
import {
  cerrarConteo,
  recontar,
  tomarConteo,
  verLugar,
  type Linea,
  type Resultado,
} from './actions'
import { palabra, plural } from '@/lib/plural'

export type Pendiente = {
  tarea: string
  posicion: string
  zona: string
  nivel: number | null
  /** Ya la abrió alguna vez: es donde se quedó. */
  empezado: boolean
}

const numero = (n: number) =>
  n.toLocaleString('es-HN', { maximumFractionDigits: 2 })

/** Como se dice una cantidad en la bodega: «5 cajas», o «5 cajas y 7 sueltas» si no es redonda. */
const cantidad = (cajas: number, sueltas: number) => {
  const enCajas = `${numero(cajas)} ${palabra(cajas, 'caja', 'cajas')}`
  return sueltas > 0
    ? `${enCajas} y ${numero(sueltas)} ${palabra(sueltas, 'suelta', 'sueltas')}`
    : enCajas
}

/**
 * Contar lo que de verdad hay.
 *
 * Es el día a día, no un proceso aparte: el que va a sacar algo y ve que hay menos lo corrige
 * ahí mismo. Por eso, cuando baja la cantidad, la pantalla termina diciendo de dónde sacar lo
 * que falta: sin eso, el que estaba surtiendo se queda a medias.
 *
 * El campo de las cajas lo arma `Cuenta`, que es donde se decide si nace lleno o vacío.
 */
export function ContarForm({
  pendientes,
  cola,
  puedeAjustar,
}: {
  pendientes: Pendiente[]
  cola: number
  /** Cambiar la cantidad sin que nadie lo haya mandado es del jefe de bodega. */
  puedeAjustar: boolean
}) {
  const [lugar, setLugar] = useState<string | null>(null)
  const [lineas, setLineas] = useState<Linea[]>([])
  const [tarea, setTarea] = useState<string | null>(null)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, empezar] = useTransition()

  const limpiar = () => {
    setLugar(null)
    setLineas([])
    setTarea(null)
    setError(null)
  }

  const abrir = (codigo: string, deTarea?: string) => {
    if (!codigo.trim()) return
    setError(null)
    setResultado(null)
    empezar(async () => {
      const res = await verLugar(codigo)
      if (!res.ok) return setError(res.error)
      setLugar(codigo.trim().toUpperCase())
      setLineas(res.lineas)
      setTarea(deTarea ?? null)
    })
  }

  const contar = (linea: Linea) => (datos: FormData) => {
    if (!lugar) return
    setError(null)
    empezar(async () => {
      const res = await recontar({
        lugar: linea.pallet ?? lugar,
        cajas: Number(datos.get('cajas') ?? 0),
        sueltas: Number(datos.get('sueltas') ?? 0),
        pallet: linea.pallet ?? undefined,
        tarea: tarea ?? undefined,
        motivo: String(datos.get('motivo') ?? ''),
      })
      if (!res.ok) return setError(res.error)
      setResultado(res.resultado)
      if (!tarea) limpiar()
      else {
        const quedan = await verLugar(linea.pallet ?? lugar)
        if (quedan.ok) setLineas(quedan.lineas)
      }
    })
  }

  const tomar = () => {
    setError(null)
    empezar(async () => {
      const res = await tomarConteo()
      if (!res.ok) return setError(res.error)
      if (!res.posicion || !res.tarea) return setError('Ya no queda nada en la cola del conteo.')
      abrir(res.posicion, res.tarea)
    })
  }

  const terminar = () => {
    if (!tarea) return
    empezar(async () => {
      const res = await cerrarConteo(tarea)
      if (!res.ok) return setError(res.error)
      limpiar()
      setResultado(null)
    })
  }

  if (!lugar) {
    return (
      <div className="flex flex-col gap-5">
        {puedeAjustar ? (
          <div className="flex flex-col gap-3">
            <ScanInput label="Escanea el lugar" disabled={pending} onScan={(c) => abrir(c)} />
            <p className="text-sm text-azul/60">
              La posición, o la matrícula del pallet. El sistema te dice lo que cree que hay y
              tú lo corriges. Lo que te caiga de tarea se cuenta a ciegas.
            </p>
            {resultado ? <Resumen resultado={resultado} /> : null}
            {error ? <Aviso>{error}</Aviso> : null}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-azul/60">
              Aquí sale lo que te toque contar. Cambiar la cantidad de una posición sin que
              nadie lo haya mandado lo hace el jefe de bodega: si ves que hay menos de lo que
              dice el sistema, avísale.
            </p>
            {resultado ? <Resumen resultado={resultado} /> : null}
            {error ? <Aviso>{error}</Aviso> : null}
          </div>
        )}

        {pendientes.length === 0 && cola > 0 ? (
          <section className="flex flex-col gap-2 rounded-2xl bg-azul-08 p-4">
            <p className="text-sm">
              Hay {plural(cola, 'posición', 'posiciones')} esperando en la cola del conteo.
            </p>
            <button type="button" onClick={tomar} disabled={pending} className={BOTON_SUAVE}>
              Tomar una
            </button>
          </section>
        ) : null}

        {!puedeAjustar && pendientes.length === 0 && cola === 0 ? (
          <p className="text-sm text-azul/60">No tienes nada que contar ahora mismo.</p>
        ) : null}

        {pendientes.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm text-azul/60">
              Tu conteo: {plural(pendientes.length, 'posición', 'posiciones')}, en orden de
              recorrido
            </h2>
            <ul className="flex flex-col gap-2">
              {pendientes.map((p) => (
                <li key={p.tarea}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => abrir(p.posicion, p.tarea)}
                    className={`${BOTON_SUAVE} h-auto flex-col items-start gap-0.5 px-4 py-3 text-left`}
                  >
                    <span className="text-base tabular-nums">{p.posicion}</span>
                    <span className="text-sm text-azul/60">
                      {p.zona}
                      {p.nivel ? ` · nivel ${p.nivel}` : ''}
                      {p.empezado ? ' · empezada' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl bg-azul-08 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-azul/60">{tarea ? 'Toca contar' : 'Contando'}</p>
          <button type="button" onClick={limpiar} className="text-sm underline underline-offset-4">
            Otro lugar
          </button>
        </div>
        <p className="text-lg tabular-nums">{lineas[0]?.posicion ?? lugar}</p>
      </div>

      {lineas.map((l) => (
        <Cuenta
          key={`${l.pallet ?? 'suelto'}-${l.sku}`}
          linea={l}
          deTarea={tarea !== null}
          pending={pending}
          onGuardar={contar(l)}
        />
      ))}

      {resultado ? <Resumen resultado={resultado} /> : null}
      {error ? <Aviso>{error}</Aviso> : null}

      {tarea ? (
        <button type="button" onClick={terminar} disabled={pending} className={BOTON_SUAVE}>
          Listo aquí, siguiente
        </button>
      ) : null}
    </div>
  )
}

/**
 * Una línea que contar.
 *
 * Dos oficios en el mismo sitio, y por eso el campo nace distinto en cada uno. En el día a
 * día —alguien va a sacar algo y ve que hay menos— la casilla viene con lo que el sistema
 * cree: casi siempre está bien y confirmar no cuesta nada. **Cuando el recuento viene de una
 * tarea de conteo cíclico nace vacía**, porque si no basta con darle a guardar para que el
 * conteo salga cuadrado sin haber contado, y la inexactitud por persona que sale de ahí
 * acabaría premiando al que no cuenta.
 *
 * El motivo aparece solo cuando lo escrito no es lo que el sistema creía. La base lo exige
 * —un ajuste de inventario mueve el saldo igual que un despacho corto—, así que preguntarlo
 * antes evita el viaje al servidor para que conteste que no.
 */
function Cuenta({
  linea,
  deTarea,
  pending,
  onGuardar,
}: {
  linea: Linea
  deTarea: boolean
  pending: boolean
  onGuardar: (datos: FormData) => void
}) {
  const [cajas, setCajas] = useState(deTarea ? '' : String(linea.cajas))
  const [sueltas, setSueltas] = useState(deTarea ? '' : String(linea.sueltas))

  const dice = linea.cajas * linea.porCaja + linea.sueltas
  const contado = Number(cajas || 0) * linea.porCaja + Number(sueltas || 0)
  const descuadra = cajas.trim() !== '' && contado !== dice

  return (
    <form className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <p className="text-lg">
          {linea.sku} {linea.nombre}
        </p>
        <p className="text-sm text-azul/70">
          {linea.pallet ? `${linea.pallet} · ` : 'Sin pallet · '}
          {deTarea ? 'cuenta lo que hay' : `el sistema dice ${cantidad(linea.cajas, linea.sueltas)}`}
        </p>
        {linea.lote || linea.vence ? (
          <p className="text-sm text-azul/60">
            {linea.lote ? `Lote ${linea.lote}` : ''}
            {linea.lote && linea.vence ? ' · ' : ''}
            {linea.vence ? `Vence ${linea.vence}` : ''}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className={ETIQUETA}>Cajas</span>
          <input
            name="cajas"
            value={cajas}
            onChange={(e) => setCajas(e.target.value)}
            required
            inputMode="decimal"
            className={`${CAMPO} tabular-nums`}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ETIQUETA}>Sueltas</span>
          <input
            name="sueltas"
            value={linea.porCaja <= 1 ? '0' : sueltas}
            onChange={(e) => setSueltas(e.target.value)}
            required
            inputMode="decimal"
            disabled={linea.porCaja <= 1}
            className={`${CAMPO} tabular-nums disabled:opacity-40`}
          />
        </label>
      </div>
      {descuadra ? (
        <label className="flex flex-col gap-1.5">
          <span className={ETIQUETA}>¿Por qué no cuadra?</span>
          <input
            name="motivo"
            required
            maxLength={200}
            placeholder="Se movió, se dañó, estaba mal apuntado…"
            className={CAMPO}
          />
        </label>
      ) : null}
      <button formAction={onGuardar} disabled={pending} className={BOTON}>
        Guardar la cuenta
      </button>
    </form>
  )
}

function Resumen({ resultado }: { resultado: Resultado }) {
  const { decia, deciaSueltas, habia, habiaSueltas, diferencia, deDonde, falta } = resultado

  if (diferencia === 0) {
    return <Logro>Cuadra: {cantidad(habia, habiaSueltas)}, como decía el sistema.</Logro>
  }

  return (
    <div className="flex flex-col gap-3">
      <Logro>
        {diferencia < 0 ? 'Bajó' : 'Subió'} de {cantidad(decia, deciaSueltas)} a{' '}
        {cantidad(habia, habiaSueltas)}.
      </Logro>
      {deDonde ? (
        <div className="rounded-2xl border border-borde p-4">
          <p className={ETIQUETA}>Lo que falta para el pedido, sácalo de</p>
          <p className="mt-1 text-lg">{deDonde}</p>
        </div>
      ) : null}
      {falta > 0 ? (
        <Aviso>
          Quedan {numero(falta)} {palabra(falta, 'caja', 'cajas')} sin apartar: no hay de dónde sacarlas. Avísale al jefe de
          bodega.
        </Aviso>
      ) : null}
    </div>
  )
}
