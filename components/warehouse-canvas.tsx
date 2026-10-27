'use client'

import { useCallback, useEffect, useRef } from 'react'
import { ANDENES, BLOQUES, COLOR, FRANJAS, NAVE, type Bloque } from '@/lib/warehouse/plano'

export type Ocupacion = Record<string, { ocupadas: number; total: number }>

/**
 * La capa estática se dibuja una sola vez en un canvas fuera de pantalla a esta
 * resolución y después solo se escala. Así cada cuadro es un drawImage, no 3,500
 * rectángulos, y no hace falta culling ni niveles de detalle.
 */
const PX_POR_METRO = 14
const ZOOM = { min: 0.4, max: 6 }

type Vista = { x: number; y: number; escala: number }

function pintarEstatico(ctx: CanvasRenderingContext2D, ocupacion: Ocupacion) {
  const k = PX_POR_METRO
  ctx.clearRect(0, 0, NAVE.ancho * k, NAVE.alto * k)

  ctx.fillStyle = COLOR.blanco
  ctx.fillRect(0, 0, NAVE.ancho * k, NAVE.alto * k)

  ctx.strokeStyle = COLOR.borde
  ctx.lineWidth = 1.5
  ctx.strokeRect(4, 4, NAVE.ancho * k - 8, NAVE.alto * k - 8)

  const ancho = 5 * k
  const alto = 1.9 * k
  ctx.fillStyle = COLOR.celeste
  for (let i = 0; i < ANDENES.norte; i++) ctx.fillRect((4 + i * 6.7) * k, 1.4 * k, ancho, alto)
  ctx.fillStyle = COLOR.verde
  for (let i = 0; i < ANDENES.sur; i++) {
    ctx.fillRect((4 + i * 6.7) * k, (NAVE.alto - 3.3) * k, ancho, alto)
  }

  for (const b of BLOQUES) {
    const datos = ocupacion[b.code]
    const pct = datos && datos.total > 0 ? datos.ocupadas / datos.total : 0

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

    ctx.fillStyle = `rgba(44, 43, 143, ${0.14 + pct * 0.76})`
    for (const c of b.celdas) ctx.fillRect(c.x * k, c.y * k, c.w * k, c.h * k)
  }

  ctx.fillStyle = 'rgba(44, 43, 143, 0.75)'
  ctx.font = `500 ${2.4 * k}px Inter, system-ui, sans-serif`
  ctx.textAlign = 'center'
  for (const b of BLOQUES) {
    const f = FRANJAS[b.franja]
    const centro = (b.x + b.ancho / 2) * k
    if (b.tipo === 'rack') {
      ctx.fillText(b.code, centro, (f.y - 1.4) * k)
    } else if (b.tipo === 'preparacion') {
      ctx.fillText('Preparación', centro, (f.y + f.alto / 2) * k)
    }
  }

  ctx.textAlign = 'left'
  ctx.fillText('Descarga', 4 * k, 6.4 * k)
  ctx.fillText('Carga', 4 * k, (NAVE.alto - 4.6) * k)
}

function etiquetasPiso(ctx: CanvasRenderingContext2D, vista: Vista) {
  ctx.save()
  ctx.font = '500 13px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const b of BLOQUES as Bloque[]) {
    if (b.tipo !== 'piso' && b.tipo !== 'rack') continue
    const f = FRANJAS[b.franja]
    const x = (b.x + b.ancho / 2) * vista.escala + vista.x
    const y = (f.y + f.alto / 2) * vista.escala + vista.y
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
    ctx.strokeStyle = 'rgba(44, 43, 143, 0.35)'
    ctx.lineWidth = 1
    const w = 40
    const h = 20
    ctx.beginPath()
    ctx.roundRect(x - w / 2, y - h / 2, w, h, 5)
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
  // La vista vive en un ref, no en estado: mover el mapa no debe re-renderizar React.
  const vistaRef = useRef<Vista>({ x: 0, y: 0, escala: 1 })
  const arrastreRef = useRef<{ x: number; y: number } | null>(null)

  const pintar = useCallback(() => {
    const canvas = canvasRef.current
    const estatico = estaticoRef.current
    if (!canvas || !estatico) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const ancho = canvas.clientWidth
    const alto = canvas.clientHeight
    if (canvas.width !== ancho * dpr || canvas.height !== alto * dpr) {
      canvas.width = ancho * dpr
      canvas.height = alto * dpr
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, ancho, alto)

    const v = vistaRef.current
    ctx.drawImage(
      estatico,
      v.x,
      v.y,
      NAVE.ancho * v.escala,
      NAVE.alto * v.escala,
    )
    etiquetasPiso(ctx, v)
  }, [])

  const encuadrar = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Encuadra por el lado que limite, para que la nave entre entera.
    const escala = Math.min(
      canvas.clientWidth / NAVE.ancho,
      canvas.clientHeight / NAVE.alto,
    )
    vistaRef.current = {
      escala,
      x: (canvas.clientWidth - NAVE.ancho * escala) / 2,
      y: (canvas.clientHeight - NAVE.alto * escala) / 2,
    }
    pintar()
  }, [pintar])

  useEffect(() => {
    const off = document.createElement('canvas')
    off.width = NAVE.ancho * PX_POR_METRO
    off.height = NAVE.alto * PX_POR_METRO
    const ctx = off.getContext('2d')
    if (ctx) pintarEstatico(ctx, ocupacion)
    estaticoRef.current = off
    encuadrar()
  }, [ocupacion, encuadrar])

  // ResizeObserver y no window.resize: al montar, el canvas todavia no tiene su
  // ancho final y el encuadre saldria corto.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const obs = new ResizeObserver(() => encuadrar())
    obs.observe(canvas)
    return () => obs.disconnect()
  }, [encuadrar])

  const zoom = useCallback((factor: number, cx: number, cy: number) => {
    const v = vistaRef.current
    const nueva = Math.min(ZOOM.max, Math.max(ZOOM.min, v.escala * factor))
    const real = nueva / v.escala
    vistaRef.current = {
      escala: nueva,
      x: cx - (cx - v.x) * real,
      y: cy - (cy - v.y) * real,
    }
    requestAnimationFrame(pintar)
  }, [pintar])

  const alejar = useCallback(() => zoom(1 / 1.3, 0, 0), [zoom])
  const acercar = useCallback(() => zoom(1.3, 0, 0), [zoom])

  return (
    <div className="relative overflow-hidden rounded-2xl border border-borde bg-white">
      <canvas
        ref={canvasRef}
        className="block h-[clamp(16rem,48vw,32rem)] w-full touch-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          arrastreRef.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerMove={(e) => {
          const a = arrastreRef.current
          if (!a) return
          const v = vistaRef.current
          vistaRef.current = { ...v, x: v.x + e.clientX - a.x, y: v.y + e.clientY - a.y }
          arrastreRef.current = { x: e.clientX, y: e.clientY }
          requestAnimationFrame(pintar)
        }}
        onPointerUp={() => {
          arrastreRef.current = null
        }}
        onWheel={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top)
        }}
      />

      <div className="absolute right-3 bottom-3 flex gap-1.5">
        <button
          type="button"
          onClick={alejar}
          aria-label="Alejar"
          className="size-10 rounded-lg border border-borde bg-white text-lg text-azul"
        >
          −
        </button>
        <button
          type="button"
          onClick={acercar}
          aria-label="Acercar"
          className="size-10 rounded-lg border border-borde bg-white text-lg text-azul"
        >
          +
        </button>
        <button
          type="button"
          onClick={encuadrar}
          className="h-10 rounded-lg border border-borde bg-white px-3 text-sm text-azul"
        >
          Encuadrar
        </button>
      </div>
    </div>
  )
}
