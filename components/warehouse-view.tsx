'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { WarehouseCanvas, type Ocupacion } from './warehouse-canvas'
import { Icon } from './ui/icon'

// ssr: false y carga diferida: Three.js solo baja cuando alguien abre la vista 3D,
// asi que el telefono del operario nunca lo descarga.
const Warehouse3D = dynamic(() => import('./warehouse-3d'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[clamp(18rem,52vw,34rem)] items-center justify-center rounded-2xl border border-borde text-sm text-azul/60">
      Cargando la vista 3D...
    </div>
  ),
})

export function WarehouseView({
  ocupacion,
  permite3D,
}: {
  ocupacion: Ocupacion
  permite3D: boolean
}) {
  const [vista, setVista] = useState<'2D' | '3D'>('2D')
  const [destino, setDestino] = useState<string | undefined>()

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

      {vista === '3D' && permite3D ? (
        <Warehouse3D ocupacion={ocupacion} />
      ) : (
        <WarehouseCanvas ocupacion={ocupacion} destino={destino} />
      )}
    </div>
  )
}
