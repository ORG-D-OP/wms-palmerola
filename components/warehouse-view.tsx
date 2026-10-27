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

  return (
    <div className="flex flex-col gap-2">
      {permite3D ? (
        <div className="flex self-end rounded-lg border border-borde p-0.5">
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

      {vista === '3D' && permite3D ? (
        <Warehouse3D ocupacion={ocupacion} />
      ) : (
        <WarehouseCanvas ocupacion={ocupacion} />
      )}
    </div>
  )
}
