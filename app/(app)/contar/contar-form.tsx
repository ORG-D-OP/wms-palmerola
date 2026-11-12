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
import { plural } from '@/lib/plural'

export type Pendiente = { tarea: string; posicion: string; zona: string; nivel: number | null }

const numero = (n: number) =>
  n.toLocaleString('es-HN', { maximumFractionDigits: 2 })

/** Como se dice una cantidad en la bodega: «5 cajas», o «5 cajas y 7 sueltas» si no es redonda. */
const cantidad = (cajas: number, sueltas: number) =>
  sueltas > 0 ? `${numero(cajas)} cajas y ${numero(sueltas)} sueltas` : `${numero(cajas)} cajas`

/**
 * Contar lo que de verdad hay.
 *
 * Es el día a día, no un proceso aparte: el que va a sacar algo y ve que hay menos lo corrige
 * ahí mismo. Por eso el campo de las cajas viene con lo que el sistema cree —casi siempre está
 * bien y confirmar no cuesta nada— y por eso, cuando baja la cantidad, la pantalla termina
 * diciendo de dónde sacar lo que falta: sin eso, el que estaba surtiendo se queda a medias.
 */
export function ContarForm({
  pendientes,
  cola,
}: {
  pendientes: Pendiente[]
  cola: number
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
        <div className="flex flex-col gap-3">
          <ScanInput label="Escanea el lugar" disabled={pending} onScan={(c) => abrir(c)} />
          <p className="text-sm text-azul/60">
            La posición, o la matrícula del pallet. El sistema te dice lo que cree que hay y tú
            lo corriges.
          </p>
          {resultado ? <Resumen resultado={resultado} /> : null}
          {error ? <Aviso>{error}</Aviso> : null}
        </div>

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
        <form key={`${l.pallet ?? 'suelto'}-${l.sku}`} className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-lg">
              {l.sku} {l.nombre}
            </p>
            <p className="text-sm text-azul/70">
              {l.pallet ? `${l.pallet} · ` : 'Sin pallet · '}
              el sistema dice {cantidad(l.cajas, l.sueltas)}
            </p>
            {l.lote || l.vence ? (
              <p className="text-sm text-azul/60">
                {l.lote ? `Lote ${l.lote}` : ''}
                {l.lote && l.vence ? ' · ' : ''}
                {l.vence ? `Vence ${l.vence}` : ''}
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className={ETIQUETA}>Cajas</span>
              <input
                name="cajas"
                defaultValue={l.cajas}
                required
                inputMode="decimal"
                className={`${CAMPO} tabular-nums`}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ETIQUETA}>Sueltas</span>
              <input
                name="sueltas"
                defaultValue={l.sueltas}
                required
                inputMode="decimal"
                disabled={l.porCaja <= 1}
                className={`${CAMPO} tabular-nums disabled:opacity-40`}
              />
            </label>
          </div>
          <button formAction={contar(l)} disabled={pending} className={BOTON}>
            Guardar la cuenta
          </button>
        </form>
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
          Quedan {numero(falta)} cajas sin apartar: no hay de dónde sacarlas. Avísale al jefe de
          bodega.
        </Aviso>
      ) : null}
    </div>
  )
}
