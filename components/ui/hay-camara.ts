'use client'

import { useSyncExternalStore } from 'react'

const sinCambios = () => () => {}
const enElNavegador = () => Boolean(navigator.mediaDevices?.getUserMedia)
const enElServidor = () => false

/** El servidor no sabe si el aparato tiene camara; el navegador si, y no cambia despues. */
export function useHayCamara() {
  return useSyncExternalStore(sinCambios, enElNavegador, enElServidor)
}
