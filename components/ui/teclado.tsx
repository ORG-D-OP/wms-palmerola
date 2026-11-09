'use client'

import { useSyncExternalStore } from 'react'
import { Icon } from './icon'

/**
 * El teclado en pantalla, encendido o apagado para este aparato.
 *
 * Hay dos clases de lector y con el teclado se portan al revés. El que manda teclas, como un
 * teclado físico, no necesita teclado en pantalla ni que el campo tenga el cursor. El de los
 * aparatos Android **es** un teclado: escribe en el campo por el mismo mecanismo, y
 * esconderlo puede dejarlo mudo. No hay forma de preguntarle al navegador cuál de los dos
 * tiene enfrente el operario, así que esto no se adivina: se prueba una vez en el teléfono y
 * se deja puesto.
 *
 * Vive en el aparato y no en el perfil, porque es del aparato: el mismo usuario en la
 * computadora de la oficina no quiere lo mismo que en el teléfono del pasillo.
 */
const CLAVE = 'wms.teclado-oculto'
const CAMBIO = 'wms:teclado'

function leer() {
  try {
    return window.localStorage.getItem(CLAVE) === 'si'
  } catch {
    return false
  }
}

/** En el servidor no hay aparato, así que el teclado se pinta como está de fábrica. */
const enElServidor = () => false

function suscribir(avisar: () => void) {
  window.addEventListener(CAMBIO, avisar)
  window.addEventListener('storage', avisar)
  return () => {
    window.removeEventListener(CAMBIO, avisar)
    window.removeEventListener('storage', avisar)
  }
}

export function useTecladoOculto() {
  return useSyncExternalStore(suscribir, leer, enElServidor)
}

function guardar(oculto: boolean) {
  try {
    window.localStorage.setItem(CLAVE, oculto ? 'si' : 'no')
  } catch {
    // Navegador sin almacenamiento: no se puede recordar, y no es motivo para fallar.
  }
  window.dispatchEvent(new Event(CAMBIO))
}

export function SwitchTeclado() {
  const oculto = useTecladoOculto()

  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-borde p-4">
      <h2 className="text-lg">El teclado de este aparato</h2>
      <p className="text-sm text-azul/60">
        Si al escanear se te sube el teclado y te tapa media pantalla, apágalo aquí. Si
        después el lector deja de escribir es que lo necesitaba: lo vuelves a encender y
        listo.
      </p>
      <button
        type="button"
        onClick={() => guardar(!oculto)}
        aria-pressed={oculto}
        className="flex items-center gap-3 self-start rounded-xl bg-azul-08 px-4 py-3 text-left hover:bg-azul-15"
      >
        <Icon name={oculto ? 'keyboard_hide' : 'keyboard'} />
        {oculto ? 'Apagado: enciende el teclado' : 'Encendido: apaga el teclado'}
      </button>
    </section>
  )
}
