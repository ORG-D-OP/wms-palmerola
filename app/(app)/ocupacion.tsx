'use client'

import { useState, useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'
import { RackFace, type Cara } from '@/components/rack-face'
import { WarehouseView } from '@/components/warehouse-view'
import type { Ocupacion as Estados } from '@/components/warehouse-canvas'
import { Aviso } from '@/components/ui/feedback'
import { BOTON_SUAVE } from '@/components/ui/campos'
import { Icon } from '@/components/ui/icon'
import { buscarCara } from './actions'

/**
 * La ocupación del almacén, en dos vistas que responden a dos preguntas distintas.
 *
 * La planta contesta «cómo va la bodega»: cada cuadro es una posición y el tono dice cuánto
 * tiene. La cara del rack contesta «qué hay en ese rack», que la planta no puede: desde
 * arriba los seis niveles son un solo cuadro. Se cambia buscando el rack, porque en el
 * tablero no hay uno «al que vas»: hay el que uno quiera mirar.
 */
export function Ocupacion({ estados, permite3D }: { estados: Estados; permite3D: boolean }) {
  const [cara, setCara] = useState<Cara | null>(null)
  const [marcada, setMarcada] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, empezar] = useTransition()

  const buscar = (texto: string) => {
    if (!texto.trim()) return
    setError(null)
    empezar(async () => {
      const res = await buscarCara(texto)
      if (!res.ok) {
        setCara(null)
        return setError(res.error)
      }
      setCara(res.cara)
      setMarcada(res.marcada)
    })
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg">Ocupación del almacén</h2>

      <div className="max-w-md">
        <ScanInput
          label="Mira un rack: escanea o escribe su código"
          disabled={pending}
          onScan={buscar}
        />
      </div>

      {error ? <Aviso>{error}</Aviso> : null}

      {cara ? (
        <div className="flex flex-col gap-3">
          <RackFace cara={cara} destino={marcada ?? undefined} />
          <button
            type="button"
            onClick={() => {
              setCara(null)
              setError(null)
            }}
            className={`${BOTON_SUAVE} max-w-md`}
          >
            <Icon name="map" />
            Ver toda la bodega
          </button>
        </div>
      ) : (
        <>
          <p className="text-sm text-azul/60">
            Cada cuadro es una posición. En los racks, un cuadro son todos sus niveles y el
            tono dice cuántos están ocupados; para verlos uno por uno, busca el rack arriba.
          </p>
          <WarehouseView ocupacion={estados} permite3D={permite3D} />
        </>
      )}
    </section>
  )
}
