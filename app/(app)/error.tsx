'use client'

import Link from 'next/link'
import { BOTON, BOTON_SUAVE } from '@/components/ui/campos'
import { Aviso } from '@/components/ui/feedback'

/**
 * Lo que se ve cuando algo se escapa sin recoger.
 *
 * Hasta ahora no había ninguna de estas pantallas en toda la aplicación, así que cualquier
 * error que no atrapara la pantalla —un permiso negado, una consulta caída— salía como la
 * pantalla de Next: fondo en blanco, «This page couldn't load. A server error occurred.» y un
 * número de diez cifras. En inglés, a alguien con un lector en la mano y un camión esperando.
 *
 * No intenta explicar qué pasó: en producción Next borra el mensaje del error antes de que
 * llegue al navegador y deja sólo el `digest`, así que decir más sería inventarlo. Lo que
 * hace es decirlo en español, dar el número para que sirva de algo cuando lo repitan por
 * radio, y dejar el trabajo a un toque de distancia: volver a intentar sin recargar, o irse al
 * tablero. Lo que **no** hace es dejar a nadie en una pantalla sin salida.
 */
export default function ErrorDeLaApp({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="flex w-full max-w-md flex-1 flex-col gap-5 p-4 pb-8">
      <h1 className="text-xl">Algo se cayó</h1>

      {/*
        Aquí no se puede decir qué pasó —en producción Next borra el mensaje y sólo queda el
        número—, así que tampoco se puede prometer nada sobre lo que quedó hecho. Nombra la
        causa más común, que es el permiso, sin afirmar que es ésa.
      */}
      <Aviso>
        Eso no se hizo. Puede que no te toque a ti, o que algo se cayera: vuelve a intentarlo.
      </Aviso>

      <p className="text-sm text-azul/60">
        Si vuelve a pasar, avisa al jefe de bodega
        {error.digest ? (
          <>
            {' '}
            y dile este número: <span className="font-mono">{error.digest}</span>
          </>
        ) : null}
        .
      </p>

      <button type="button" onClick={reset} className={BOTON}>
        Volver a intentar
      </button>
      <Link href="/" className={`${BOTON_SUAVE} text-center`}>
        Ir al tablero
      </Link>
    </main>
  )
}
