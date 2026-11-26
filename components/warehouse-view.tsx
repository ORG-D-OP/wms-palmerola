'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import {
  WarehouseCanvas,
  type Modo,
  type Ocupacion,
  type Segmentos,
  type Toque,
} from './warehouse-canvas'

import { COLOR, OCUPACION, type Pilas, PLANIMETRIA, tonoOcupada } from '@/lib/warehouse/plano'
import { Icon } from './ui/icon'

// ssr: false y carga diferida: Three.js solo baja cuando alguien abre la vista 3D,
// asi que el telefono del operario nunca lo descarga.
const Warehouse3D = dynamic(() => import('./warehouse-3d'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[clamp(18rem,52vw,34rem)] xl:h-[calc(100dvh-21rem)] xl:min-h-80 items-center justify-center rounded-2xl border border-borde text-sm text-azul/60">
      Cargando la vista 3D...
    </div>
  ),
})

const MODOS: { id: Modo; texto: string }[] = [
  { id: 'ocupacion', texto: 'Ocupación' },
  { id: 'planimetria', texto: 'Planimetría' },
]

type Viñeta = { color: string; texto: string; forma?: 'raya' }

/**
 * La leyenda sale de la misma paleta que pintan los dos mapas, así que no puede desfasarse.
 * Antes cada vista tenía sus colores escritos a mano: el «otro uso» de la leyenda era gris y
 * el del mapa de arriba un azul casi blanco, y al pasar a 3D ninguna viñeta cuadraba.
 */
const LEYENDA_PLANIMETRIA: Viñeta[] = [
  { color: PLANIMETRIA.ALIMENTO.cara, texto: 'alimento, cara de picking' },
  { color: PLANIMETRIA.ALIMENTO.reserva, texto: 'alimento, almacén' },
  { color: PLANIMETRIA.NO_ALIMENTO.cara, texto: 'no alimento, cara de picking' },
  { color: PLANIMETRIA.NO_ALIMENTO.reserva, texto: 'no alimento, almacén' },
]

const LEYENDA_OCUPACION: Viñeta[] = [
  { color: OCUPACION.libre, texto: 'libre' },
  { color: tonoOcupada(1), texto: 'con producto' },
  { color: OCUPACION.apartada, texto: 'apartada por una tarea' },
  { color: OCUPACION.otroUso, texto: 'otro uso' },
]

const LEYENDA_GUIADO: Viñeta[] = [
  { color: COLOR.verde, texto: 'la posición que buscas' },
  { color: COLOR.verde, texto: 'cómo llegar', forma: 'raya' },
]

export function WarehouseView({
  ocupacion,
  permite3D,
  segmentos,
  pilas,
  onTocar,
}: {
  ocupacion: Ocupacion
  permite3D: boolean
  /** Sin esto el mapa solo sabe pintar la ocupación: no hay nada que segmentar. */
  segmentos?: Segmentos
  /** Los pallets apilados en cada posición de piso. */
  pilas?: Pilas
  onTocar?: (toque: Toque) => void
}) {
  const [vista, setVista] = useState<'2D' | '3D'>('2D')
  const [modo, setModo] = useState<Modo>('ocupacion')
  const [destino, setDestino] = useState<string | undefined>()

  const enDosD = vista === '2D' || !permite3D
  // La leyenda dice lo que esta vista está pintando y nada más: el destino y la ruta sólo
  // existen en la planta, así que en el isométrico no se anuncian.
  const viñetas =
    modo === 'planimetria'
      ? LEYENDA_PLANIMETRIA
      : [...LEYENDA_OCUPACION, ...(enDosD && destino ? LEYENDA_GUIADO : [])]

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-0 flex-1 gap-2"
          action={(datos) => {
            const code = String(datos.get('posicion') ?? '').trim().toUpperCase()
            setDestino(code || undefined)
            setVista('2D')
          }}
        >
          <input
            name="posicion"
            placeholder="Buscar posición, por ejemplo F3-012-07"
            className="h-11 min-w-0 flex-1 rounded-xl border border-borde px-3 outline-none focus:border-celeste"
          />
          <button
            aria-label="Buscar"
            className="flex h-11 items-center rounded-xl bg-azul px-4 text-white"
          >
            <Icon name="search" />
          </button>
        </form>

        {segmentos ? (
          <div className="flex rounded-lg border border-borde p-0.5">
            {MODOS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setModo(m.id)}
                aria-pressed={modo === m.id}
                className={`flex h-9 items-center rounded-md px-3 text-sm ${
                  modo === m.id ? 'bg-azul text-white' : 'text-azul/60'
                }`}
              >
                {m.texto}
              </button>
            ))}
          </div>
        ) : null}

        {permite3D ? (
          <div className="flex rounded-lg border border-borde p-0.5">
            {(['2D', '3D'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVista(v)}
                aria-pressed={vista === v}
                className={`flex h-9 items-center gap-1 rounded-md px-3 text-sm ${
                  vista === v ? 'bg-azul text-white' : 'text-azul/60'
                }`}
              >
                {v === '3D' ? <Icon name="deployed_code" className="!text-[18px]" /> : null}
                {v}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* En computadora la leyenda se va a su propia columna: el plano se queda con el ancho. */}
      <div className="flex flex-col gap-2 xl:grid xl:grid-cols-[10rem_minmax(0,1fr)] xl:items-start xl:gap-4">
        {enDosD ? (
          <WarehouseCanvas
            ocupacion={ocupacion}
            destino={destino}
            modo={modo}
            segmentos={segmentos}
            pilas={pilas}
            onTocar={onTocar}
          />
        ) : (
          <Warehouse3D ocupacion={ocupacion} modo={modo} segmentos={segmentos} pilas={pilas} />
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-azul/60 xl:col-start-1 xl:row-start-1 xl:flex-col xl:items-start xl:gap-3 xl:rounded-2xl xl:border xl:border-borde xl:p-4">
          <h3 className="hidden text-xs text-azul/50 xl:block">Leyenda</h3>

          {viñetas.map((l) => (
            <span key={l.texto} className="flex items-center gap-1.5">
              <span
                className={`shrink-0 ${l.forma === 'raya' ? 'h-1 w-4 rounded-full' : 'h-3 w-3 rounded-[3px] outline outline-borde'}`}
                style={{ background: l.color }}
              />{' '}
              {l.texto}
            </span>
          ))}

          {modo === 'ocupacion' && enDosD ? (
            <p className="hidden xl:block xl:text-azul/50">
              Cuanto más oscuro, más lleno. En el piso, cada raya blanca es un pallet más
              encima.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
