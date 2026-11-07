'use client'

import dynamic from 'next/dynamic'
import { useRef, useState } from 'react'
import { Icon } from './icon'
import { useHayCamara } from './hay-camara'

const Camara = dynamic(() => import('./camara').then((m) => m.Camara), { ssr: false })

/**
 * Camara para un campo de formulario corriente: lee y escribe el codigo donde se le diga.
 *
 * Todo lo que esta impreso en bodega se puede escanear —el DUN-14 de la caja, la matricula
 * del pallet, el codigo de la posicion, el tabulado de la hoja—, asi que ningun campo que
 * reciba uno de esos deberia obligar a teclear.
 *
 * Con `enviar` manda el formulario de una vez: sirve en los buscadores, donde el codigo es
 * lo unico que hace falta. Sin `enviar` solo llena el campo, porque en los formularios que
 * piden algo mas —la cantidad, el anden— mandarlo a medias seria un error.
 */
export function BotonCamara({ campo, enviar = false }: { campo: string; enviar?: boolean }) {
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
    if (enviar) formulario.requestSubmit()
    else entrada.focus()
  }

  return (
    <>
      <button
        ref={boton}
        type="button"
        onClick={() => setAbierta(true)}
        aria-label={enviar ? 'Buscar escaneando' : 'Escanear con la cámara'}
        className="flex h-14 items-center rounded-xl border border-borde px-4 text-azul"
      >
        <Icon name="photo_camera" />
      </button>
      {abierta && <Camara onLeer={recibir} onCerrar={() => setAbierta(false)} />}
    </>
  )
}
