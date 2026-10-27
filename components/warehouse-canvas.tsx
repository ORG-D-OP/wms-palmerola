'use client'

import { useCallback, useEffect, useRef } from 'react'
import { ANDENES, BLOQUES, COLOR, FRANJAS, NAVE } from '@/lib/warehouse/plano'
import { Icon } from '@/components/ui/icon'

export type Ocupacion = Record<string, { ocupadas: number; total: number }>

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
    const d = ocupacion[b.code]
    const pct = d && d.total > 0 ? d.ocupadas / d.total : 0
    ctx.fillStyle = `rgba(44, 43, 143, ${0.14 + pct * 0.76})`
    for (const c of b.celdas) ctx.fillRect(c.x * k, c.y * k, c.w * k, c.h * k)
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
  ctx.fillText('Descarga', 4 * k, 6.4 * k)
  ctx.fillText('Carga', 4 * k, (NAVE.alto - 4.6) * k)
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

export function WarehouseCanvas({ ocupacion }: { ocupacion: Ocupacion }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const estaticoRef = useRef<HTMLCanvasElement | null>(null)
  // La vista vive en un ref: mover el mapa no debe re-renderizar React.
  const vistaRef = useRef<Vista>({ x: 0, y: 0, escala: 1 })
  const minRef = useRef(1)
  const punterosRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<number | null>(null)

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
  }, [])

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
        }}
        onPointerMove={(e) => {
          const previos = punterosRef.current
          if (!previos.has(e.pointerId)) return
          const anterior = previos.get(e.pointerId)!
          previos.set(e.pointerId, { x: e.clientX, y: e.clientY })

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
        }}
        onPointerCancel={(e) => {
          punterosRef.current.delete(e.pointerId)
          pinchRef.current = null
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
