import Link from 'next/link'
import { BOTON_SUAVE } from '@/components/ui/campos'

export const metadata = { title: 'Esto no te toca · WMS Palmerola' }

/**
 * Lo que se ve al pedir una pantalla que no es suya.
 *
 * Antes caía en `error.tsx` con un **500**: «Algo se cayó», un botón de volver a intentar que
 * no podía funcionar y el `digest` de Next —diez cifras— para que fuera a molestar al jefe de
 * bodega con él. Probado a clic el 25/11 con la cuenta del montacarguista en `/kpi`, y lo
 * mismo en `/personal`, `/areas` y `/conteos`. No se había caído nada: es que no le toca.
 *
 * No adivina el motivo. Son dos —el permiso que no tiene, y el oficio que lleva hoy en el
 * turno— y desde aquí no hay forma de saber cuál fue sin inventarlo, así que lo dice entero y
 * deja la salida a un toque. Al menú no le hace falta nada: estas pantallas ya no se le
 * ofrecen, y aquí sólo se llega escribiendo la dirección o con un marcador viejo.
 */
export default function SinPermiso() {
  return (
    <main className="flex w-full max-w-md flex-1 flex-col gap-5 p-4 pb-8 md:p-8">
      <h1 className="text-xl">Esto no te toca</h1>

      <p>
        Esta pantalla no es tuya: o la lleva el jefe de bodega, o no es de lo que estás haciendo
        hoy en el turno.
      </p>

      <p className="text-sm text-azul/60">
        Si te hace falta, pídesela al jefe de bodega. No tienes que avisar de nada: no se cayó
        nada.
      </p>

      <Link href="/" className={`${BOTON_SUAVE} text-center`}>
        Ir al tablero
      </Link>
    </main>
  )
}
