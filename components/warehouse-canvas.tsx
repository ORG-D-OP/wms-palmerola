'use client'

import { useCallback, useEffect, useRef } from 'react'
import {
  andenMasCercano,
  ANDENES,
  BLOQUES,
  claveDePlanta,
  COLOR,
  colorPlanimetria,
  FRANJAS,
  NAVE,
  OCUPACION,
  type Pilas,
  type Punto,
  rectangulo,
  ruta,
  tonoOcupada,
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

/**
 * La segmentación de la planimetría: qué cuadros son del no alimento y qué **posiciones**
 * tiene cada área que no sea el almacén. Es lo que se redibuja cada semana y lo que no se
 * puede deducir mirando la ocupación. El área va por posición porque la cara de picking de un
 * rack es el nivel 1 del frente y nada más; el grupo va por cuadro porque es de la corrida
 * entera (migración 0102).
 */
export type Segmentos = { no_alimento: string[]; areas: Record<string, string[]> }

/** Qué cuenta el mapa: cuánto hay, o de quién es cada hueco. */
export type Modo = 'ocupacion' | 'planimetria'

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

/**
 * El tono dice qué tan llena está esa posición. En rack, cuántos de sus niveles están
 * ocupados, porque desde arriba los seis niveles son un solo cuadro. En piso no hay niveles
 * pero sí apilado: un cuadro con tres pallets encima no es lo mismo que uno con uno, y antes
 * los dos salían del mismo azul. La cara con nivel por nivel sale al llegar al rack, en
 * Guardar y en Surtir.
 */
function tono(c: Conteo | undefined, niveles: number, pila?: { hay: number; caben: number }) {
  if (!c) return OCUPACION.libre
  if (c.ocupadas > 0) {
    return tonoOcupada(pila && pila.caben > 0 ? pila.hay / pila.caben : c.ocupadas / niveles)
  }
  if (c.apartadas > 0) return OCUPACION.apartada
  return OCUPACION.otroUso
}

/**
 * La planta se dibuja una sola vez en un canvas fuera de pantalla a esta resolución y
 * después solo se escala: cada cuadro es un drawImage, no 3,469 rectángulos.
 */
const PX_POR_METRO = 14
/** Suficiente para leer una posición suelta; más allá solo se ven píxeles. */
const ESCALA_MAX = 22

type Vista = { x: number; y: number; escala: number }

function pintarEstatico(
  ctx: CanvasRenderingContext2D,
  ocupacion: Ocupacion,
  modo: Modo,
  segmentos?: Segmentos,
  pilas: Pilas = {},
) {
  const k = PX_POR_METRO
  const cuadros = porCuadro(ocupacion)
  const noAlimento = new Set(segmentos?.no_alimento ?? [])
  // Aquí cada cuadro lleva un solo color, así que un cuadro de rack es cara si alguno de sus
  // niveles lo es. El nivel se ve en el isométrico, que dibuja las cajas una por una.
  const picking = new Set((segmentos?.areas?.PICKING ?? []).map(claveDePlanta))
  const plano = modo === 'planimetria' && segmentos !== undefined
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
      const pila = pilas[c.code]
      ctx.fillStyle = plano
        ? colorPlanimetria(c.code, noAlimento, picking)
        : tono(cuadros.get(c.code), niveles, pila)
      ctx.fillRect(c.x * k, c.y * k, c.w * k, c.h * k)

      /*
        Los pallets apilados, uno por raya. El tono ya dice cuán lleno va el cuadro, pero de
        lejos «lleno» y «lleno a la mitad» son dos azules y nadie cuenta azules: las rayas
        dicen cuántos pallets hay, y al alejarse se funden en el tono sin estorbar.
      */
      if (!plano && pila && pila.hay > 1) {
        ctx.save()
        ctx.strokeStyle = COLOR.blanco
        ctx.lineWidth = Math.max(1, 0.06 * k)
        ctx.beginPath()
        for (let n = 1; n < pila.hay; n++) {
          const y = (c.y + (c.h * n) / pila.hay) * k
          ctx.moveTo(c.x * k, y)
          ctx.lineTo((c.x + c.w) * k, y)
        }
        ctx.stroke()
        ctx.restore()
      }
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
    la de abajo lleva los cuatro de mayoreo y los cuatro de despacho a cross, que cargan, y
    seis de recepción, que descargan. Ahora dicen el número, que es con lo que la gente los llama
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

/** La raya de la ruta: trozo pintado y hueco. Camina un ciclo entero por vuelta. */
const RAYA = [10, 8]
/** Lo que dura una vuelta del latido y del caminar de la raya, en milisegundos. */
const CICLO = 1400
/** Lo más chico que se deja ver la marca del destino, aunque el cuadro sea de un píxel. */
const MARCA_MINIMA = 16

/** La punta de flecha al final del camino, apuntando como el último tramo. */
function puntaDeFlecha(ctx: CanvasRenderingContext2D, desde: Punto, hasta: Punto) {
  const angulo = Math.atan2(hasta.y - desde.y, hasta.x - desde.x)
  ctx.save()
  ctx.translate(hasta.x, hasta.y)
  ctx.rotate(angulo)
  ctx.fillStyle = COLOR.verde
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(-11, -6)
  ctx.lineTo(-11, 6)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/**
 * Dibuja el camino y marca el destino encima de la planta ya pintada.
 *
 * El destino se ilumina en **su cuadro**, no en un círculo encima: lo que la persona va a
 * mirar es la posición, y un círculo tapaba justo el cuadro que buscaba. La ruta es una raya
 * que camina hacia allá, porque una raya quieta no dice para qué lado se va.
 */
function guiado(
  ctx: CanvasRenderingContext2D,
  v: Vista,
  fase: number,
  origen?: string,
  destino?: string,
) {
  const fin = destino ? ubicar(destino) : null
  if (!fin) return
  // Sin origen explicito, se traza desde el anden de descarga mas cercano.
  const ini = ubicar(origen ?? andenMasCercano(fin))
  const aPantalla = (p: Punto) => ({ x: p.x * v.escala + v.x, y: p.y * v.escala + v.y })

  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  if (ini) {
    const puntos = ruta(ini, fin).map(aPantalla)
    const trazo = () => {
      ctx.beginPath()
      ctx.moveTo(puntos[0]!.x, puntos[0]!.y)
      for (const p of puntos.slice(1)) ctx.lineTo(p.x, p.y)
      ctx.stroke()
    }

    ctx.strokeStyle = COLOR.verde
    // El halo: sin él la raya se pierde sobre los cuadros azules.
    ctx.globalAlpha = 0.3
    ctx.lineWidth = 11
    trazo()
    ctx.globalAlpha = 1
    ctx.lineWidth = 4
    ctx.setLineDash(RAYA)
    ctx.lineDashOffset = -fase * (RAYA[0]! + RAYA[1]!)
    trazo()
    ctx.setLineDash([])

    const ultimo = puntos[puntos.length - 1]!
    const penultimo = puntos[puntos.length - 2] ?? puntos[0]!
    puntaDeFlecha(ctx, penultimo, ultimo)

    const a = aPantalla(ini)
    ctx.fillStyle = COLOR.azul
    ctx.beginPath()
    ctx.arc(a.x, a.y, 9, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = COLOR.blanco
    ctx.beginPath()
    ctx.arc(a.x, a.y, 3.5, 0, Math.PI * 2)
    ctx.fill()
  }

  const centro = aPantalla(fin)
  const celda = rectangulo(destino!)
  const ancho = Math.max(MARCA_MINIMA, (celda?.w ?? 0) * v.escala)
  const alto = Math.max(MARCA_MINIMA, (celda?.h ?? 0) * v.escala)
  const x = centro.x - ancho / 2
  const y = centro.y - alto / 2

  // El latido: el cuadro se enciende y se apaga, como en el diseño del celular.
  const latido = 0.55 + 0.45 * Math.cos(fase * Math.PI * 2)
  ctx.fillStyle = COLOR.blanco
  ctx.fillRect(x, y, ancho, alto)
  ctx.globalAlpha = latido
  ctx.fillStyle = COLOR.verde
  ctx.fillRect(x, y, ancho, alto)
  ctx.globalAlpha = 1

  ctx.strokeStyle = COLOR.azul
  ctx.lineWidth = 2
  ctx.strokeRect(x - 3, y - 3, ancho + 6, alto + 6)

  // El aro que se abre y se desvanece: dice «aquí» sin tapar nada.
  const radio = Math.max(ancho, alto) / 2
  ctx.globalAlpha = 0.9 * (1 - fase)
  ctx.beginPath()
  ctx.arc(centro.x, centro.y, radio + fase * radio * 2.5, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 1

  ctx.font = '500 13px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  const etiqueta = destino!
  const anchoTexto = ctx.measureText(etiqueta).width + 12
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.beginPath()
  ctx.roundRect(centro.x - anchoTexto / 2, y - 28, anchoTexto, 20, 5)
  ctx.fill()
  ctx.strokeStyle = COLOR.borde
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = COLOR.azul
  ctx.textBaseline = 'middle'
  ctx.fillText(etiqueta, centro.x, y - 18)
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

/**
 * Qué celda de la planta está debajo de un punto, en metros de la nave.
 *
 * Entre cuadro y cuadro hay un hueco dibujado —la separación que deja ver que son
 * posiciones distintas— y ese hueco es casi la mitad de la superficie del bloque. Pedir que
 * el dedo caiga dentro del cuadro hacía que uno de cada dos toques no agarrara nada. Así que
 * dentro de un bloque gana el cuadro **más cercano**, que es el que la persona creyó tocar.
 */
function celdaEn(x: number, y: number): Toque | null {
  for (const b of BLOQUES) {
    if (b.tipo === 'preparacion') continue
    const f = FRANJAS[b.franja]
    if (x < b.x || x > b.x + b.ancho || y < f.y || y > f.y + f.alto) continue

    let cerca: (typeof b.celdas)[number] | undefined
    let menor = Infinity
    for (const c of b.celdas) {
      // Distancia al cuadro, cero si el punto cayó dentro.
      const dx = Math.max(c.x - x, 0, x - (c.x + c.w))
      const dy = Math.max(c.y - y, 0, y - (c.y + c.h))
      const d = dx * dx + dy * dy
      if (d < menor) {
        menor = d
        cerca = c
        if (d === 0) break
      }
    }
    if (!cerca) return { bloque: b.code, celda: b.code, prefijo: b.code }
    return {
      bloque: b.code,
      celda: cerca.code,
      prefijo: b.tipo === 'rack' ? cerca.code.replace(/-\d+$/, '') : cerca.code,
    }
  }
  return null
}

export function WarehouseCanvas({
  ocupacion,
  origen,
  destino,
  onTocar,
  modo = 'ocupacion',
  segmentos,
  pilas,
}: {
  ocupacion: Ocupacion
  origen?: string
  destino?: string
  /** Un toque sobre la planta, con el bloque y la celda que agarró. */
  onTocar?: (toque: Toque) => void
  modo?: Modo
  segmentos?: Segmentos
  /** Los pallets apilados en cada posición de piso. Sin esto, el piso se pinta de a uno. */
  pilas?: Pilas
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
  // En que punto del ciclo va la animacion del destino. En un ref: late sin re-renderizar.
  const faseRef = useRef(0)

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
    guiado(ctx, v, faseRef.current, origen, destino)
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
    if (ctx) pintarEstatico(ctx, ocupacion, modo, segmentos, pilas)
    estaticoRef.current = off
    encuadrar()
  }, [ocupacion, modo, segmentos, pilas, encuadrar])

  /*
    Mientras haya un destino, el cuadro late y la raya camina. Fuera de eso el mapa no se
    repinta solo: un bucle permanente es la pestaña del jefe gastando batería todo el día.
  */
  useEffect(() => {
    if (!destino) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let id = 0
    const paso = (t: number) => {
      faseRef.current = (t % CICLO) / CICLO
      pintar()
      id = requestAnimationFrame(paso)
    }
    id = requestAnimationFrame(paso)
    return () => {
      cancelAnimationFrame(id)
      faseRef.current = 0
    }
  }, [destino, pintar])

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
        /*
          La flecha de siempre, no la manita de arrastrar: lo que casi siempre se hace aquí
          es darle clic a un cuadro, y con la manita uno no sabe si va a mover el mapa.
          Arrastrar sigue arrastrando, y ahí sí cambia el cursor.
        */
        className="block h-[clamp(18rem,52vw,34rem)] xl:h-[calc(100dvh-21rem)] xl:min-h-80 w-full cursor-default touch-none active:cursor-grabbing"
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
