'use client'

import { useRouter } from 'next/navigation'
import { WarehouseCanvas } from '@/components/warehouse-canvas'

/**
 * Escoger el rango tocándolo en el plano.
 *
 * Buscar por código funciona cuando uno ya sabe que la primera columna de F1 es `F1-001`.
 * El jefe de bodega no tiene por qué saberlo: ve la bodega, no una lista de códigos. Un toque
 * sobre el cuadro llena la búsqueda con lo que hay ahí debajo —la posición en piso, el carril
 * entero en rack— y la pantalla cuenta lo que agarró antes de cambiar nada.
 */
export function Plano({ seleccionado }: { seleccionado?: string }) {
  const router = useRouter()

  return (
    <div className="flex flex-col gap-2">
      <WarehouseCanvas
        ocupacion={{}}
        destino={seleccionado}
        onTocar={(t) => router.push(`/areas?q=${encodeURIComponent(t.prefijo)}`)}
      />
      <p className="text-sm text-azul/60">
        Toca un cuadro para escogerlo. En piso agarra esa posición; en rack, el carril
        completo, porque desde arriba los niveles son un solo cuadro.
      </p>
    </div>
  )
}
