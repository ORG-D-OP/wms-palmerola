'use client'

import dynamic from 'next/dynamic'
import { useRef, useState } from 'react'
import { Icon } from './icon'
import { useHayCamara } from './hay-camara'

const Camara = dynamic(() => import('./camara').then((m) => m.Camara), { ssr: false })

/**
 * Camara para un formulario de busqueda corriente: lee, escribe el codigo en el campo que
 * se le indique y manda el formulario.
 *
 * Los buscadores de productos y de inventario aceptan DUN-14, matricula de pallet y codigo
 * de posicion, que es justo lo que hay impreso en bodega. Teclear catorce digitos parado
 * frente a un rack no tiene sentido si la caja los trae en un codigo de barras.
 */
export function BotonCamara({ campo }: { campo: string }) {
  const boton = useRef<HTMLButtonElement>(null)
  const [abierta, setAbierta] = useState(false)
  const hayCamara = useHayCamara()

  if (!hayCamara) return null

  function recibir(codigo: string) {
    setAbierta(false)
    const formulario = boton.current?.form
    const entrada = formulario?.elements.namedItem(campo)
    if (!formulario || !(entrada instanceof HTMLInputElement)) return
    entrada.value = codigo
    formulario.requestSubmit()
  }

  return (
    <>
      <button
        ref={boton}
        type="button"
        onClick={() => setAbierta(true)}
        aria-label="Buscar escaneando"
        className="flex h-14 items-center rounded-xl border border-borde px-4 text-azul"
      >
        <Icon name="photo_camera" />
      </button>
      {abierta && <Camara onLeer={recibir} onCerrar={() => setAbierta(false)} />}
    </>
  )
}
