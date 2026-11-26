'use client'

import { useState, useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'
import { RackFace, type Cara } from '@/components/rack-face'
import { WarehouseView } from '@/components/warehouse-view'
import type { Ocupacion as Estados, Segmentos } from '@/components/warehouse-canvas'
import type { Pilas } from '@/lib/warehouse/plano'
import { Aviso } from '@/components/ui/feedback'
import { BOTON_SUAVE } from '@/components/ui/campos'
import { Icon } from '@/components/ui/icon'
import { fecha } from '@/lib/fechas'
import { buscarCara, queHayEn, type Hueco } from './actions'
import { plural } from '@/lib/plural'

/**
 * La ocupación del almacén, en dos vistas que responden a dos preguntas distintas.
 *
 * La planta contesta «cómo va la bodega»: cada cuadro es una posición y el tono dice cuánto
 * tiene. La cara del rack contesta «qué hay en ese rack», que la planta no puede: desde
 * arriba los seis niveles son un solo cuadro. Se cambia buscando el rack, porque en el
 * tablero no hay uno «al que vas»: hay el que uno quiera mirar.
 */
export function Ocupacion({
  estados,
  segmentos,
  pilas,
  permite3D,
}: {
  estados: Estados
  segmentos: Segmentos
  pilas: Pilas
  permite3D: boolean
}) {
  const [cara, setCara] = useState<Cara | null>(null)
  const [marcada, setMarcada] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cuadro, setCuadro] = useState<{ code: string; huecos: Hueco[] } | null>(null)
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

  const tocar = (code: string) => {
    setCuadro(null)
    empezar(async () => {
      const res = await queHayEn(code)
      if (!res.ok) return setError(res.error)
      setError(null)
      setCuadro({ code, huecos: res.huecos })
    })
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="contents xl:flex xl:items-start xl:gap-8">
        <h2 className="text-lg">Ocupación del almacén</h2>

        <div className="max-w-md xl:flex-1">
          <ScanInput
            label="Mira un rack: escanea o escribe su código"
            disabled={pending}
            onScan={buscar}
          />
        </div>
      </div>

      {error ? <Aviso>{error}</Aviso> : null}

      {cara ? (
        <div className="flex flex-col gap-3 xl:max-w-5xl">
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
          {cuadro ? <Cuadro cuadro={cuadro} onCerrar={() => setCuadro(null)} /> : null}
          <WarehouseView
            ocupacion={estados}
            segmentos={segmentos}
            pilas={pilas}
            permite3D={permite3D}
            onTocar={(t) => tocar(t.celda)}
          />
        </>
      )}
    </section>
  )
}

/**
 * Por qué no hay nada en esa posición, que no es lo mismo que estar libre.
 *
 * Una apartada por una tarea ya tiene dueño: alguien va en camino con su pallet, y mandarle
 * otro encima es el descuadre de mañana. El mapa lo pintaba de celeste y el panel decía
 * «libre», que es la contraria de lo que el color estaba diciendo.
 */
function porQueEstaVacia(h: Hueco): string {
  if (h.apartada) return 'apartada por una tarea'
  if (!h.guarda) return h.usage_name ?? 'otro uso'
  return 'libre'
}

/**
 * Lo que hay debajo del cuadro que se tocó.
 *
 * En piso es una posición y en rack son sus niveles, porque desde arriba se ven como un solo
 * cuadro. Las posiciones vacías también salen: la mitad de las veces lo que uno va a mirar al
 * mapa es dónde queda sitio.
 */
function Cuadro({
  cuadro,
  onCerrar,
}: {
  cuadro: { code: string; huecos: Hueco[] }
  onCerrar: () => void
}) {
  const primero = cuadro.huecos[0]
  const llenos = cuadro.huecos.filter((h) => h.sku !== null)
  // Un pallet mixto son varias filas de la misma matrícula: lo que se apila son matrículas.
  const pallets = new Set(llenos.map((h) => h.lpn_code ?? h.location_code)).size
  const apila = primero && primero.caben !== null && primero.caben > 1

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-borde p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base">{cuadro.code}</h3>
          <p className="text-sm text-azul/60">
            {primero
              ? `${primero.area ?? 'sin área'} · ${
                  primero.grupo === 'NO_ALIMENTO' ? 'no alimento' : 'alimento'
                }${primero.dist_despacho_m ? ` · ${primero.dist_despacho_m} m a despacho` : ''}`
              : 'No hay ninguna posición con ese código'}
          </p>
          {apila ? (
            <p className="text-sm text-azul/60">
              {pallets} de {plural(primero.caben ?? 0, 'pallet apilado', 'pallets apilados')}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-borde text-azul"
        >
          <Icon name="close" />
        </button>
      </div>

      {cuadro.huecos.length === 0 ? null : llenos.length === 0 ? (
        <p className="text-sm text-azul/60">Está libre.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {cuadro.huecos.map((h, i) => (
            <li
              key={`${h.location_code}-${h.lpn_code ?? i}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-borde/50 pt-2 text-sm first:border-0 first:pt-0"
            >
              <span className="font-medium">{h.location_code}</span>
              {h.sku ? (
                <>
                  <span>
                    {h.sku} · {h.nombre}
                  </span>
                  <span className="text-azul/60">
                    {h.cajas
                      ? plural(h.cajas, 'caja', 'cajas')
                      : plural(h.qty_base ?? 0, 'unidad', 'unidades')}
                    {h.lot ? ` · lote ${h.lot}` : ''} · vence {fecha(h.expiry_date)}
                    {h.lpn_code ? ` · ${h.lpn_code}` : ''}
                  </span>
                </>
              ) : (
                <span className="text-azul/60">{porQueEstaVacia(h)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
