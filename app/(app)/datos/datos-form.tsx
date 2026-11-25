'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { Aviso } from '@/components/ui/feedback'
import { BOTON } from '@/components/ui/campos'
import { abrirLibro } from '@/lib/xlsx'
import { leer, type Leido } from '@/lib/sap/leer'
import { NOMBRE, fechaDelArchivo, tandas, type Reporte } from '@/lib/sap/reportes'
import { plural } from '@/lib/plural'
import { cargarTanda, registrarCarga, zonaDelPronostico } from './actions'

/**
 * Cuántas filas van en cada envío. Vercel corta el cuerpo en 4.5 MB y una fila de ingreso
 * pesa unos 200 bytes, así que dos mil caben de sobra; el número también le da a la barra
 * algo que enseñar en los archivos grandes.
 */
const TANDA = 2000

/** Por qué campo se agrupa cada reporte para que un documento no se parta entre dos envíos. */
const CLAVE = {
  INGRESO: (f: { pedido: string }) => f.pedido,
  DESPACHO: (f: { transporte: string }) => f.transporte,
  INVENTARIO: (f: { material: string }) => f.material,
  PRONOSTICO: (f: { material: string }) => f.material,
  SALIDAS: (f: { pedido: string }) => f.pedido,
  TRAZA: () => '',
} as const

const FILAS: Record<Reporte, (l: Leido) => unknown[]> = {
  INGRESO: (l) => l.ingresos ?? [],
  DESPACHO: (l) => l.despachos ?? [],
  INVENTARIO: (l) => l.inventario ?? [],
  PRONOSTICO: (l) => l.pronostico ?? [],
  SALIDAS: (l) => l.salidas ?? [],
  TRAZA: () => [],
}

type Avance = { kind: Reporte; leidas: number; avisos: string[] }

type Estado =
  | { paso: 'leyendo' }
  | (Avance & { paso: 'subiendo'; hechas: number; de: number })
  | (Avance & { paso: 'listo'; detalle: Record<string, number> })
  | { paso: 'error'; error: string }

type Archivo = { nombre: string; estado: Estado }

/** Las claves que devuelven las funciones de la base, dichas como las diría una persona. */
const TEXTO: Record<string, [string, string]> = {
  documentos: ['pedido', 'pedidos'],
  lineas: ['línea', 'líneas'],
  pallets: ['pallet', 'pallets'],
  camiones: ['camión', 'camiones'],
  materiales: ['material', 'materiales'],
  filas: ['fila', 'filas'],
  cajas: ['caja', 'cajas'],
  de_la_zona: ['fila de la zona', 'filas de la zona'],
  sin_producto: ['fila con material fuera del maestro', 'filas con material fuera del maestro'],
  a_ciegas: ['pedido sin número de traslado', 'pedidos sin número de traslado'],
  clase_641: ['traslado 641', 'traslados 641'],
  clase_303: ['movimiento 303', 'movimientos 303'],
  clase_304: ['anulación 304', 'anulaciones 304'],
}

const detalleEnPalabras = (detalle: Record<string, number>) =>
  Object.entries(detalle)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => plural(v, ...(TEXTO[k] ?? [k, k])))
    .join(' · ')

/**
 * La pantalla donde caen los Excel de SAP.
 *
 * El archivo se abre aquí mismo, en la máquina de quien lo sube: Vercel no deja pasar un
 * cuerpo de más de 4.5 MB y el de despacho pesa ocho. Al servidor viajan las filas ya
 * entendidas, por tandas, y una tanda nunca parte un documento por la mitad.
 *
 * Nadie tiene que acertar un desplegable: el reporte se reconoce por sus columnas.
 */
export function DatosForm() {
  const [archivos, setArchivos] = useState<Archivo[]>([])
  const [trabajando, setTrabajando] = useState(false)
  const entrada = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const actualizar = (i: number, estado: Estado) =>
    setArchivos((previos) => previos.map((a, j) => (j === i ? { ...a, estado } : a)))

  async function procesar(lista: File[]) {
    if (lista.length === 0 || trabajando) return
    setArchivos(lista.map((f) => ({ nombre: f.name, estado: { paso: 'leyendo' } })))
    setTrabajando(true)

    const zona = await zonaDelPronostico()

    for (const [i, file] of lista.entries()) {
      try {
        const libro = await abrirLibro(new Uint8Array(await file.arrayBuffer()))
        const leido = await leer(libro, zona)
        if (!leido) {
          actualizar(i, {
            paso: 'error',
            error: 'No se reconoce: no trae las columnas de ninguno de los reportes conocidos.',
          })
          continue
        }

        const avance: Avance = { kind: leido.kind, leidas: leido.leidas, avisos: leido.avisos }
        const filas = FILAS[leido.kind](leido)
        const total: Record<string, number> = { ...leido.resumen }
        let hechas = 0
        actualizar(i, { ...avance, paso: 'subiendo', hechas, de: filas.length })

        let problema: string | null = null
        for (const tanda of tandas(filas, CLAVE[leido.kind] as (f: unknown) => string, TANDA)) {
          const res = await cargarTanda(leido.kind, tanda, fechaDelArchivo(file.name))
          if (!res.ok) {
            problema = res.error
            break
          }
          for (const [k, v] of Object.entries(res.detalle)) total[k] = (total[k] ?? 0) + v
          hechas += tanda.length
          actualizar(i, { ...avance, paso: 'subiendo', hechas, de: filas.length })
        }

        if (problema) {
          actualizar(i, { paso: 'error', error: problema })
          continue
        }

        await registrarCarga(leido.kind, file.name, leido.leidas, total)
        actualizar(i, { ...avance, paso: 'listo', detalle: total })
      } catch (e) {
        actualizar(i, { paso: 'error', error: e instanceof Error ? e.message : 'No se pudo leer.' })
      }
    }

    setTrabajando(false)
    // La tabla de abajo la pinta el servidor: sin esto se queda enseñando la subida anterior.
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          void procesar([...e.dataTransfer.files])
        }}
        className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-borde p-6 text-center transition-colors hover:bg-azul-08"
      >
        <input
          ref={entrada}
          type="file"
          multiple
          accept=".xlsx"
          disabled={trabajando}
          className="sr-only"
          onChange={(e) => {
            void procesar([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
        <span className="text-lg">Suelta aquí los Excel de SAP</span>
        <span className="text-sm text-azul/60">
          O haz clic para buscarlos. Se reconocen solos por sus columnas: ingreso, despacho,
          existencia, pronóstico, salidas y trazabilidad.
        </span>
      </label>

      {archivos.length > 0 ? (
        <ul className="flex flex-col divide-y divide-borde">
          {archivos.map((a) => (
            <li key={a.nombre} className="flex flex-col gap-1.5 py-3">
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 flex-1 truncate">{a.nombre}</span>
                <span className="shrink-0 text-sm tabular-nums text-azul/60">
                  {a.estado.paso === 'leyendo' ? 'Leyendo...' : null}
                  {a.estado.paso === 'subiendo'
                    ? `${a.estado.hechas.toLocaleString('es-HN')} / ${a.estado.de.toLocaleString('es-HN')}`
                    : null}
                  {a.estado.paso === 'listo' ? 'Cargado' : null}
                </span>
              </span>

              {a.estado.paso === 'subiendo' || a.estado.paso === 'listo' ? (
                <span className="text-sm text-azul/60">
                  {NOMBRE[a.estado.kind]} — {plural(a.estado.leidas, 'fila leída', 'filas leídas')}
                </span>
              ) : null}

              {a.estado.paso === 'listo' && detalleEnPalabras(a.estado.detalle) ? (
                <span className="text-sm">{detalleEnPalabras(a.estado.detalle)}</span>
              ) : null}

              {/* Los avisos no son errores: son las filas que el reporte trae y no se guardan,
                  con el motivo. El rojo se queda para lo que de verdad falló. */}
              {(a.estado.paso === 'subiendo' || a.estado.paso === 'listo') &&
              a.estado.avisos.length > 0 ? (
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-azul/60">
                  {a.estado.avisos.map((aviso) => (
                    <li key={aviso}>{aviso}</li>
                  ))}
                </ul>
              ) : null}

              {a.estado.paso === 'error' ? <Aviso>{a.estado.error}</Aviso> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        disabled={trabajando}
        onClick={() => entrada.current?.click()}
        className={BOTON}
      >
        {trabajando ? 'Cargando...' : 'Buscar archivos'}
      </button>
    </div>
  )
}
