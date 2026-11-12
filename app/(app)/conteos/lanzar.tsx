'use client'

import { useActionState } from 'react'
import { Aviso, Logro } from '@/components/ui/feedback'
import { BOTON, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { lanzarConteo } from './actions'
import { plural } from '@/lib/plural'

export type Opcion = { valor: string; nombre: string }

/**
 * El jefe escoge qué se cuenta y el sistema lo reparte.
 *
 * Los criterios son los que hay: zona, área y nivel. Falta escoger por A, B o C —«a los de A
 * hay que darles conteos mucho más seguidos»—, y falta porque el ABC todavía no se calcula.
 */
export function Lanzar({ zonas, areas, niveles }: {
  zonas: Opcion[]
  areas: Opcion[]
  niveles: number[]
}) {
  const [estado, lanzar, pending] = useActionState(lanzarConteo, null)

  return (
    <form action={lanzar} className="flex flex-col gap-4 rounded-2xl border border-borde p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className={ETIQUETA}>Zona</span>
          <select name="zona" className={CAMPO} defaultValue="">
            <option value="">Toda la bodega</option>
            {zonas.map((z) => (
              <option key={z.valor} value={z.valor}>
                {z.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ETIQUETA}>Área</span>
          <select name="area" className={CAMPO} defaultValue="">
            <option value="">Todas</option>
            {areas.map((a) => (
              <option key={a.valor} value={a.valor}>
                {a.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ETIQUETA}>Nivel</span>
          <select name="nivel" className={CAMPO} defaultValue="">
            <option value="">Todos</option>
            {niveles.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'Piso' : `Nivel ${n}`}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button type="submit" disabled={pending} className={BOTON}>
        {pending ? 'Lanzando...' : 'Lanzar el conteo'}
      </button>

      {estado?.ok ? (
        <Logro>
          {estado.lanzado.tareas} posiciones que contar.{' '}
          {estado.lanzado.personas > 0
            ? `Repartidas entre ${plural(estado.lanzado.personas, 'persona', 'personas')}, un tramo seguido cada quien.`
            : 'Nadie está trabajando ahora mismo, así que quedan en la cola para el que entre.'}
        </Logro>
      ) : null}
      {estado && !estado.ok ? <Aviso>{estado.error}</Aviso> : null}
    </form>
  )
}
