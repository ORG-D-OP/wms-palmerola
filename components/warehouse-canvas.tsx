'use client'

import { useCallback, useEffect, useRef } from 'react'
import {
  andenMasCercano,
  ANDENES,
  BLOQUES,
  claveDePlanta,
  COLOR,
  FRANJAS,
  NAVE,
  ruta,
  ubicar,
} from '@/lib/warehouse/plano'
import { Icon } from '@/components/ui/icon'

export type Estado = 'OCUPADA' | 'APARTADA' | 'OTRO_USO'

/**
 * El estado de cada posición que no está libre, por su código. Antes esto era el resumen
 * de la zona y el mapa pintaba sus cientos de posiciones del mismo tono: decía «F3 va al
 * 34%» pero no cuál posición estaba ocupada, que es justo lo que uno va a ver al mapa.
 */
export type Ocupacion = Record<string, Estado>

type Conteo = { ocupadas: number; apartadas: number; otros: number }

/** Lo que hay en cada cuadro de la planta; en rack, la pila entera de niveles. */
function porCuadro(ocupacion: Ocupacion): Map<string, Conteo> {
  const cuadros = new Map<string, Conteo>()
  for (const [code, estado] of Object.entries(ocupacion)) {
    const clave = claveDePlanta(code)
    const c = cuadros.get(clave) ?? { ocupadas: 0, apartadas: 0, otros: 0 }
    if (estado === 'OCUPADA') c.ocupadas++
    else if (estado === 'APARTADA') c.apartadas++
    else c.otros++
    cuadros.set(clave, c)
  }
  return cuadros
}

const LIBRE = 'rgba(44, 43, 143, 0.1)'
const OTRO_USO = 'rgba(44, 43, 143, 0.055)'
const APARTADA = 'rgba(0, 155, 221, 0.45)'

/**
 * El tono dice qué tan llena está esa posición. En piso es sí o no; en rack, cuántos de
 * sus niveles están ocupados, porque desde arriba los seis niveles son un solo cuadro. La
 * cara con nivel por nivel sale al llegar al rack, en Guardar y en Surtir.
 */
function tono(c: Conteo | undefined, niveles: number) {
  if (!c) return LIBRE
  if (c.ocupadas > 0) return `rgba(44, 43, 143, ${0.3 + (c.ocupadas / niveles) * 0.7})`
  if (c.apartadas > 0) return APARTADA
  return OTRO_USO
}

/**
 * La planta se dibuja una sola vez en un canvas fuera de pantalla a esta resolución y
 * después solo se escala: cada cuadro es un drawImage, no 3,469 rectángulos.
 */
const PX_POR_METRO = 14
/** Suficiente para leer una posición suelta; más allá solo se ven píxeles. */
const ESCALA_MAX = 22

type Vista = { x: number; y: number; escala: number }

function pintarEstatico(ctx: CanvasRenderingContext2D, ocupacion: Ocupacion) {
  const k = PX_POR_METRO
  const cuadros = porCuadro(ocupacion)
  ctx.fillStyle = COLOR.blanco
  ctx.fillRect(0, 0, NAVE.ancho * k, NAVE.alto * k)

  ctx.strokeStyle = COLOR.borde
  ctx.lineWidth = 1.5
  ctx.strokeRect(4, 4, NAVE.ancho * k - 8, NAVE.alto * k - 8)

  ctx.fillStyle = COLOR.celeste
  for (let i = 0; i < ANDENES.norte; i++) {
    ctx.fillRect((4 + i * 6.7) * k, 1.4 * k, 5 * k, 1.9 * k)
  }
  ctx.fillStyle = COLOR.verde
  for (let i = 0; i < ANDENES.sur; i++) {
    ctx.fillRect((4 + i * 6.7) * k, (NAVE.alto - 3.3) * k, 5 * k, 1.9 * k)
  }

  for (const b of BLOQUES) {
    if (b.tipo === 'preparacion') {
      const f = FRANJAS[b.franja]
      ctx.save()
      ctx.setLineDash([5, 5])
      ctx.strokeStyle = 'rgba(44, 43, 143, 0.3)'
      ctx.lineWidth = 1
      ctx.strokeRect(b.x * k, f.y * k, b.ancho * k, f.alto * k)
      ctx.restore()
      continue
    }
    const niveles = b.niveles ?? 1
    for (const c of b.celdas) {
      ctx.fillStyle = tono(cuadros.get(c.code), niveles)
      ctx.fillRect(c.x * k, c.y * k, c.w * k, c.h * k)
    }
  }

  ctx.fillStyle = 'rgba(44, 43, 143, 0.75)'
  ctx.font = `500 ${2.4 * k}px Inter, system-ui, sans-serif`
  ctx.textAlign = 'center'
  for (const b of BLOQUES) {
    const f = FRANJAS[b.franja]
    const centro = (b.x + b.ancho / 2) * k
    if (b.tipo === 'rack') ctx.fillText(b.code, centro, (f.y - 1.4) * k)
    if (b.tipo === 'preparacion') ctx.fillText('Preparación', centro, (f.y + f.alto / 2) * k)
  }
  ctx.textAlign = 'left'
  /*
    Decía «Descarga» arriba y «Carga» abajo, y ninguna de las dos franjas es de una sola cosa:
    la de abajo lleva los cuatro de mayoreo y los cuatro de crossdock, que cargan, y seis de
    recepción, que descargan. Ahora dicen el número, que es con lo que la gente los llama
    —«el nueve»— y es lo único que la franja entera tiene en común. El oficio de cada andén
    lo lleva la base, y se ve en su pantalla.
  */
  ctx.fillText(
    `Andenes ${ANDENES.primeroDelNorte}–${ANDENES.sur + ANDENES.norte}`,
    4 * k,
    6.4 * k,
  )
  ctx.fillText(`Andenes 1–${ANDENES.sur}`, 4 * k, (NAVE.alto - 4.6) * k)
}

function etiquetas(ctx: CanvasRenderingContext2D, v: Vista) {
  ctx.save()
  ctx.font = '500 12px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const b of BLOQUES) {
    if (b.tipo === 'preparacion') continue
    const f = FRANJAS[b.franja]
    const x = (b.x + b.ancho / 2) * v.escala + v.x
    const y = (f.y + f.alto / 2) * v.escala + v.y
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.strokeStyle = 'rgba(44, 43, 143, 0.3)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(x - 21, y - 10, 42, 20, 5)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = COLOR.azul
    ctx.fillText(b.code, x, y + 1)
  }
  ctx.restore()
}

/** Dibuja el camino y marca el destino encima de la planta ya pintada. */
function guiado(ctx: CanvasRenderingContext2D, v: Vista, origen?: string, destino?: string) {
  const fin = destino ? ubicar(destino) : null
  if (!fin) return
  // Sin origen explicito, se traza desde el anden de descarga mas cercano.
  const ini = ubicar(origen ?? andenMasCercano(fin))
  const aPantalla = (p: { x: number; y: number }) => ({
    x: p.x * v.escala + v.x,
    y: p.y * v.escala + v.y,
  })

  ctx.save()
  if (ini) {
    const puntos = ruta(ini, fin).map(aPantalla)
    ctx.strokeStyle = COLOR.verde
    ctx.lineWidth = 4
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.setLineDash([10, 7])
    ctx.beginPath()
    ctx.moveTo(puntos[0]!.x, puntos[0]!.y)
    for (const p of puntos.slice(1)) ctx.lineTo(p.x, p.y)
    ctx.stroke()
    ctx.setLineDash([])

    const a = aPantalla(ini)
    ctx.fillStyle = COLOR.blanco
    ctx.strokeStyle = COLOR.azul
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(a.x, a.y, 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }

  const b = aPantalla(fin)
  ctx.fillStyle = COLOR.verde
  ctx.strokeStyle = COLOR.azul
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.arc(b.x, b.y, 11, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = COLOR.azul
  ctx.font = '500 13px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(destino!, b.x, b.y - 18)
  ctx.restore()
}

export type Toque = {
  bloque: string
  celda: string
  /**
   * Un código con el que empiezan las posiciones de verdad que hay ahí debajo.
   *
   * En piso el cuadro es una posición y su código sirve tal cual. En rack no: desde arriba
   * los seis niveles son un solo cuadro, y el nivel va en medio del código
   * (`R-ABA-L01-N3-05`), así que el cuadro no es prefijo de nada. Lo que sí es prefijo es el
   * carril, que además es como se habla de la bodega.
   */
  prefijo: string
}

/** Qué celda de la planta está debajo de un punto, en metros de la nave. */
function celdaEn(x: number, y: number): Toque | null {
  for (const b of BLOQUES) {
    if (b.tipo === 'preparacion') continue
    const f = FRANJAS[b.franja]
    if (x < b.x || x > b.x + b.ancho || y < f.y || y > f.y + f.alto) continue
    for (const c of b.celdas) {
      if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
        return {
          bloque: b.code,
          celda: c.code,
          prefijo: b.tipo === 'rack' ? c.code.replace(/-\d+$/, '') : c.code,
        }
      }
    }
    return { bloque: b.code, celda: b.code, prefijo: b.code }
  }
  return null
}

export function WarehouseCanvas({
  ocupacion,
  origen,
  destino,
  onTocar,
}: {
  ocupacion: Ocupacion
  origen?: string
  destino?: string
  /** Un toque sobre la planta, con el bloque y la celda que agarró. */
  onTocar?: (toque: Toque) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const estaticoRef = useRef<HTMLCanvasElement | null>(null)
  // La vista vive en un ref: mover el mapa no debe re-renderizar React.
  const vistaRef = useRef<Vista>({ x: 0, y: 0, escala: 1 })
  const minRef = useRef(1)
  const punterosRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<number | null>(null)
  // Un toque es un puntero que bajo y subio casi en el mismo sitio; mas que eso es arrastre.
  const toqueRef = useRef<{ x: number; y: number; movido: boolean } | null>(null)

  const pintar = useCallback(() => {
    const canvas = canvasRef.current
    const estatico = estaticoRef.current
    if (!canvas || !estatico) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const { clientWidth: w, clientHeight: h } = canvas
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr
      canvas.height = h * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const v = vistaRef.current
    ctx.drawImage(estatico, v.x, v.y, NAVE.ancho * v.escala, NAVE.alto * v.escala)
    etiquetas(ctx, v)
    guiado(ctx, v, origen, destino)
  }, [origen, destino])

  /** Nunca deja que la nave se salga de la vista: si cabe entera, la centra. */
  const encajar = useCallback((v: Vista): Vista => {
    const canvas = canvasRef.current
    if (!canvas) return v
    const w = NAVE.ancho * v.escala
    const h = NAVE.alto * v.escala
    const x =
      w <= canvas.clientWidth
        ? (canvas.clientWidth - w) / 2
        : Math.min(0, Math.max(canvas.clientWidth - w, v.x))
    const y =
      h <= canvas.clientHeight
        ? (canvas.clientHeight - h) / 2
        : Math.min(0, Math.max(canvas.clientHeight - h, v.y))
    return { ...v, x, y }
  }, [])

  const encuadrar = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // El mínimo es el encuadre: alejar más solo deja la nave flotando en un vacío.
    const escala = Math.min(canvas.clientWidth / NAVE.ancho, canvas.clientHeight / NAVE.alto)
    minRef.current = escala
    vistaRef.current = encajar({ escala, x: 0, y: 0 })
    pintar()
  }, [encajar, pintar])

  const zoom = useCallback(
    (factor: number, cx: number, cy: number) => {
      const v = vistaRef.current
      const escala = Math.min(ESCALA_MAX, Math.max(minRef.current, v.escala * factor))
      if (escala === v.escala) return
      const r = escala / v.escala
      vistaRef.current = encajar({
        escala,
        x: cx - (cx - v.x) * r,
        y: cy - (cy - v.y) * r,
      })
      requestAnimationFrame(pintar)
    },
    [encajar, pintar],
  )

  useEffect(() => {
    const off = document.createElement('canvas')
    off.width = NAVE.ancho * PX_POR_METRO
    off.height = NAVE.alto * PX_POR_METRO
    const ctx = off.getContext('2d')
    if (ctx) pintarEstatico(ctx, ocupacion)
    estaticoRef.current = off
    encuadrar()
  }, [ocupacion, encuadrar])

  // ResizeObserver: al montar el canvas todavia no tiene su ancho final.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const obs = new ResizeObserver(() => encuadrar())
    obs.observe(canvas)
    return () => obs.disconnect()
  }, [encuadrar])

  // Listener propio y no pasivo: con el de React la pagina se desplaza por debajo y
  // uno deja de saber si esta moviendo el mapa o la pantalla.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = canvas.getBoundingClientRect()
      zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [zoom])

  const centro = () => {
    const canvas = canvasRef.current
    return canvas ? { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 } : { x: 0, y: 0 }
  }
  const alejar = useCallback(() => {
    const c = centro()
    zoom(1 / 1.4, c.x, c.y)
  }, [zoom])
  const acercar = useCallback(() => {
    const c = centro()
    zoom(1.4, c.x, c.y)
  }, [zoom])

  const distancia = () => {
    const [a, b] = [...punterosRef.current.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-borde bg-white">
      <canvas
        ref={canvasRef}
        className="block h-[clamp(18rem,52vw,34rem)] w-full cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          punterosRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          pinchRef.current = distancia()
          toqueRef.current = { x: e.clientX, y: e.clientY, movido: false }
        }}
        onPointerMove={(e) => {
          const previos = punterosRef.current
          if (!previos.has(e.pointerId)) return
          const anterior = previos.get(e.pointerId)!
          previos.set(e.pointerId, { x: e.clientX, y: e.clientY })

          const t = toqueRef.current
          if (t && Math.hypot(e.clientX - t.x, e.clientY - t.y) > 6) t.movido = true

          if (previos.size >= 2) {
            const ahora = distancia()
            const antes = pinchRef.current
            if (ahora && antes) {
              const r = e.currentTarget.getBoundingClientRect()
              const [a, b] = [...previos.values()]
              zoom(ahora / antes, (a!.x + b!.x) / 2 - r.left, (a!.y + b!.y) / 2 - r.top)
            }
            pinchRef.current = ahora
            return
          }

          const v = vistaRef.current
          vistaRef.current = encajar({
            ...v,
            x: v.x + e.clientX - anterior.x,
            y: v.y + e.clientY - anterior.y,
          })
          requestAnimationFrame(pintar)
        }}
        onPointerUp={(e) => {
          punterosRef.current.delete(e.pointerId)
          pinchRef.current = null

          const t = toqueRef.current
          toqueRef.current = null
          if (!onTocar || !t || t.movido) return
          const r = e.currentTarget.getBoundingClientRect()
          const v = vistaRef.current
          const toque = celdaEn(
            (e.clientX - r.left - v.x) / v.escala,
            (e.clientY - r.top - v.y) / v.escala,
          )
          if (toque) onTocar(toque)
        }}
        onPointerCancel={(e) => {
          punterosRef.current.delete(e.pointerId)
          pinchRef.current = null
          toqueRef.current = null
        }}
      />

      <div className="absolute right-3 bottom-3 flex gap-1.5">
        <button
          type="button"
          onClick={alejar}
          aria-label="Alejar"
          className="flex size-11 items-center justify-center rounded-lg border border-borde bg-white text-azul"
        >
          <Icon name="remove" />
        </button>
        <button
          type="button"
          onClick={acercar}
          aria-label="Acercar"
          className="flex size-11 items-center justify-center rounded-lg border border-borde bg-white text-azul"
        >
          <Icon name="add" />
        </button>
        <button
          type="button"
          onClick={encuadrar}
          className="flex h-11 items-center gap-1.5 rounded-lg border border-borde bg-white px-3 text-sm text-azul"
        >
          <Icon name="fit_screen" className="!text-[20px]" />
          Encuadrar
        </button>
      </div>
    </div>
  )
}
