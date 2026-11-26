import Link from 'next/link'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/roles'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { plural } from '@/lib/plural'
import { RetornablesForm } from './retornables-form'

export const metadata = { title: 'Retornables · WMS Palmerola' }

/**
 * La cuenta de pallets vacíos y corrugado.
 *
 * La pantalla ofrecía escanear aunque no hubiera **ni un** espacio de retornables marcado: las
 * 5,605 posiciones de la bodega son de uso `PRODUCTO`, así que cualquier cosa que se escaneara
 * contestaba que no es un espacio de retornables. Ahora, si no hay ninguno, lo dice de entrada
 * y manda a marcarlos, que es una tarea de arranque y no un fallo.
 */
export default async function RetornablesPage() {
  const user = await requirePermission('inventario:mover')

  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('retornables').select('code, uso, cantidad').order('code')

  const todos = data ?? []
  const conCuenta = todos.filter((e) => Number(e.cantidad ?? 0) > 0)
  const puedeMarcar = can(user.roles, 'areas:administrar')

  if (todos.length === 0) {
    return (
      <main className="flex w-full max-w-md flex-1 flex-col gap-6 p-4 pb-8 md:p-8">
        <h1 className="text-xl">Pallets vacíos y corrugado</h1>
        <div className="flex flex-col gap-3 rounded-2xl bg-azul-08 p-4">
          <p>Todavía no hay ningún espacio de retornables en la bodega.</p>
          <p className="text-sm text-azul/70">
            Hay que marcar primero qué posiciones guardan pallets vacíos, corrugado de retorno o
            ramplas. Se hace en Áreas: se escoge el rango de posiciones y se le cambia el uso.
          </p>
          {puedeMarcar ? (
            <Link href="/areas" className="text-sm underline underline-offset-4">
              Ir a Áreas a marcarlos
            </Link>
          ) : (
            <p className="text-sm text-azul/60">Los marca el jefe de bodega.</p>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="flex w-full max-w-md flex-1 flex-col gap-6 p-4 pb-8 md:p-8">
      <h1 className="text-xl">Pallets vacíos y corrugado</h1>
      <RetornablesForm />

      {conCuenta.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm text-azul/60">Lo que hay ahora</h2>
          <ul className="flex flex-col divide-y divide-borde text-sm">
            {conCuenta.map((e) => (
              <li key={e.code} className="flex items-baseline gap-3 py-2">
                <span className="w-28 shrink-0 tabular-nums">{e.code}</span>
                <span className="min-w-0 flex-1 truncate text-azul/60">{e.uso}</span>
                <span className="tabular-nums">{Number(e.cantidad).toLocaleString('es-HN')}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-sm text-azul/60">
          Hay {plural(todos.length, 'espacio marcado', 'espacios marcados')} y ninguno tiene nada
          apuntado todavía.
        </p>
      )}
    </main>
  )
}
