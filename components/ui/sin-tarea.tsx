'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { Aviso } from './feedback'

/**
 * Cuando no hay nada que hacer.
 *
 * No lleva botón de «tomar tarea»: quien está disponible y parado en un andén no tiene por
 * qué pedir trabajo, el trabajo le cae. Lo único que hace falta es volver a preguntar
 * cuando la pantalla regresa al frente, que es justo lo que pasa cuando el operario vuelve
 * de hacer otra cosa.
 *
 * El enlace a disponibilidad está porque la causa más común de que no caiga nada no es que
 * la bodega esté al día: es que la persona no entró a trabajo, o la movieron de andén.
 */
export function SinTarea({
  texto,
  error,
  reintentar,
}: {
  texto: string
  error: string | null
  reintentar: () => void
}) {
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === 'visible') reintentar()
    }
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('focus', alVolver)
    return () => {
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('focus', alVolver)
    }
  }, [reintentar])

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      {error ? <Aviso>{error}</Aviso> : <p className="text-azul/60">{texto}</p>}
      <Link href="/turno" className="text-sm underline underline-offset-4">
        Mi disponibilidad y mi andén
      </Link>
    </div>
  )
}
