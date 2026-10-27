'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { cajas, NAVE } from '@/lib/warehouse/plano'
import type { Ocupacion } from './warehouse-canvas'

/**
 * Vista isométrica del almacén. Todas las posiciones entran en un solo InstancedMesh:
 * una llamada de dibujo para las 5,581, y el color de cada instancia dice su estado.
 *
 * Este componente solo se carga en supervisión, con next/dynamic y ssr: false, para que
 * el teléfono del operario nunca descargue Three.js.
 */
export default function Warehouse3D({ ocupacion }: { ocupacion: Ocupacion }) {
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

    const grupos = cajas()
    const total = grupos.reduce((s, g) => s + g.cajas.length, 0)

    const malla = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial(),
      total,
    )
    const m = new THREE.Matrix4()
    const vacia = new THREE.Color('#c9c9e4')
    const llena = new THREE.Color('#2c2b8f')
    let i = 0

    for (const g of grupos) {
      const d = ocupacion[g.bloque.code]
      const pct = d && d.total > 0 ? d.ocupadas / d.total : 0
      const color = vacia.clone().lerp(llena, pct)
      for (const c of g.cajas) {
        m.makeScale(c.w, c.alto, c.d)
        m.setPosition(c.x + c.w / 2, c.y + c.alto / 2, c.z + c.d / 2)
        malla.setMatrixAt(i, m)
        malla.setColorAt(i, color)
        i++
      }
    }
    malla.instanceMatrix.needsUpdate = true
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
  }, [ocupacion])

  return (
    <div
      ref={contenedorRef}
      className="h-[clamp(18rem,52vw,34rem)] w-full cursor-grab touch-none overflow-hidden rounded-2xl border border-borde active:cursor-grabbing"
    />
  )
}
