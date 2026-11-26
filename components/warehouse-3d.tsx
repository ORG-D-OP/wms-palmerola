'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { cajas, COLOR, colorPlanimetria, NAVE, OCUPACION, type Pilas } from '@/lib/warehouse/plano'
import type { Modo, Ocupacion, Segmentos } from './warehouse-canvas'

/**
 * Vista isométrica del almacén. Todas las posiciones entran en un solo InstancedMesh:
 * una llamada de dibujo para las 5,581, y el color de cada instancia dice su estado.
 *
 * Pinta lo mismo que el mapa de arriba, en los dos modos. Mientras sólo pintó la ocupación,
 * la leyenda decía planimetría y las cajas decían otra cosa: lo apartado por una tarea se leía
 * como cara de picking del no alimento.
 *
 * Este componente solo se carga en supervisión, con next/dynamic y ssr: false, para que
 * el teléfono del operario nunca descargue Three.js.
 */
export default function Warehouse3D({
  ocupacion,
  modo,
  segmentos,
  pilas,
}: {
  ocupacion: Ocupacion
  modo: Modo
  segmentos?: Segmentos
  /** Los pallets apilados en cada posición de piso: aquí se dibuja la pila de verdad. */
  pilas?: Pilas
}) {
  const contenedorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const contenedor = contenedorRef.current
    if (!contenedor) return

    const escena = new THREE.Scene()
    escena.background = new THREE.Color('#ffffff')

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    contenedor.appendChild(renderer.domElement)

    const camara = new THREE.OrthographicCamera()
    camara.position.set(NAVE.ancho, 95, NAVE.alto * 1.25)
    camara.lookAt(NAVE.ancho / 2, 0, NAVE.alto / 2)

    escena.add(new THREE.AmbientLight(0xffffff, 1.5))
    const sol = new THREE.DirectionalLight(0xffffff, 1.6)
    sol.position.set(60, 90, 30)
    escena.add(sol)

    const piso = new THREE.Mesh(
      new THREE.PlaneGeometry(NAVE.ancho, NAVE.alto),
      new THREE.MeshBasicMaterial({ color: '#2c2b8f', transparent: true, opacity: 0.05 }),
    )
    piso.rotation.x = -Math.PI / 2
    piso.position.set(NAVE.ancho / 2, -0.02, NAVE.alto / 2)
    escena.add(piso)

    const grupos = cajas(pilas)
    const total = grupos.reduce((s, g) => s + g.cajas.length, 0)

    const malla = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial(),
      total,
    )
    const m = new THREE.Matrix4()
    // Cada caja es una posicion con su nivel, asi que el color es el de esa posicion y no
    // el promedio de la zona: aqui se ve en que nivel esta puesto el pallet.
    // Los mismos colores que el mapa de arriba y que la leyenda, de `plano.ts`: cada vista
    // tenía los suyos escritos a mano y el celeste de aquí no era el celeste de allá.
    const COLORES = {
      libre: new THREE.Color(OCUPACION.libre),
      OCUPADA: new THREE.Color(COLOR.azul),
      APARTADA: new THREE.Color(OCUPACION.apartada),
      OTRO_USO: new THREE.Color(OCUPACION.otroUso),
    }
    const noAlimento = new Set(segmentos?.no_alimento ?? [])
    const picking = new Set(segmentos?.areas?.PICKING ?? [])
    const plano = modo === 'planimetria' && segmentos !== undefined
    // Un color por posición se repite miles de veces: se guardan para no construir THREE.Color
    // en cada una de las 5,581 cajas.
    const tintes = new Map<string, THREE.Color>()
    const colorPlano = (code: string) => {
      const hex = colorPlanimetria(code, noAlimento, picking)
      const ya = tintes.get(hex)
      if (ya) return ya
      const color = new THREE.Color(hex)
      tintes.set(hex, color)
      return color
    }
    let i = 0

    for (const g of grupos) {
      for (const c of g.cajas) {
        m.makeScale(c.w, c.alto, c.d)
        m.setPosition(c.x + c.w / 2, c.y + c.alto / 2, c.z + c.d / 2)
        malla.setMatrixAt(i, m)
        malla.setColorAt(i, plano ? colorPlano(c.code) : COLORES[ocupacion[c.code] ?? 'libre'])
        i++
      }
    }
    malla.instanceMatrix.needsUpdate = true
    if (malla.instanceColor) malla.instanceColor.needsUpdate = true
    escena.add(malla)

    let giro = Math.PI / 4
    const radio = 105

    const encuadrar = () => {
      const { clientWidth: w, clientHeight: h } = contenedor
      renderer.setSize(w, h)
      // La nave proyectada en isometrica mide unos 172 x 100 m; se encuadra a lo que
      // limite para que llene el marco sin cortarse.
      const proyectado = { ancho: 174, alto: 104 }
      const escala = Math.min(w / proyectado.ancho, h / proyectado.alto)
      const mediaAncho = w / escala / 2
      const mediaAlto = h / escala / 2
      camara.left = -mediaAncho
      camara.right = mediaAncho
      camara.top = mediaAlto
      camara.bottom = -mediaAlto
      camara.updateProjectionMatrix()
    }

    const colocar = () => {
      camara.position.set(
        NAVE.ancho / 2 + Math.cos(giro) * radio,
        78,
        NAVE.alto / 2 + Math.sin(giro) * radio,
      )
      camara.lookAt(NAVE.ancho / 2, 0, NAVE.alto / 2)
      renderer.render(escena, camara)
    }

    encuadrar()
    colocar()

    const obs = new ResizeObserver(() => {
      encuadrar()
      colocar()
    })
    obs.observe(contenedor)

    let arrastre: number | null = null
    const lienzo = renderer.domElement
    const abajo = (e: PointerEvent) => {
      arrastre = e.clientX
      lienzo.setPointerCapture(e.pointerId)
    }
    const mover = (e: PointerEvent) => {
      if (arrastre === null) return
      giro += (e.clientX - arrastre) * 0.006
      arrastre = e.clientX
      requestAnimationFrame(colocar)
    }
    const arriba = () => {
      arrastre = null
    }
    lienzo.addEventListener('pointerdown', abajo)
    lienzo.addEventListener('pointermove', mover)
    lienzo.addEventListener('pointerup', arriba)
    lienzo.addEventListener('pointercancel', arriba)

    return () => {
      obs.disconnect()
      lienzo.removeEventListener('pointerdown', abajo)
      lienzo.removeEventListener('pointermove', mover)
      lienzo.removeEventListener('pointerup', arriba)
      lienzo.removeEventListener('pointercancel', arriba)
      malla.geometry.dispose()
      ;(malla.material as THREE.Material).dispose()
      renderer.dispose()
      lienzo.remove()
    }
  }, [ocupacion, modo, segmentos, pilas])

  return (
    <div
      ref={contenedorRef}
      className="h-[clamp(18rem,52vw,34rem)] xl:h-[calc(100dvh-21rem)] xl:min-h-80 w-full cursor-default touch-none overflow-hidden rounded-2xl border border-borde active:cursor-grabbing"
    />
  )
}
