import { requirePermission } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NOMBRE, type Reporte } from '@/lib/sap/reportes'
import { fechaYHora as cuando } from '@/lib/warehouse/hora'
import { DatosForm } from './datos-form'
import { plural } from '@/lib/plural'

export const metadata = { title: 'Datos de SAP · WMS Palmerola' }

/**
 * De aquí come el sistema entero: el ingreso sabe qué trae el camión y el despacho qué lleva
 * porque alguien subió estos Excel. Por eso lo primero que se ve es cuándo se subió cada uno:
 * un reporte viejo no da error en ninguna pantalla, simplemente deja de cuadrar con la calle.
 */
export default async function DatosPage() {
  await requirePermission('datos:cargar')

  const supabase = await createSupabaseServerClient()
  const { data: cargas } = await supabase
    .from('ultima_carga')
    .select('kind, file_name, rows_read, uploaded_at, persona')

  const porKind = new Map((cargas ?? []).map((c) => [c.kind as Reporte, c]))

  return (
    <main className="flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 pb-8 md:p-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl">Datos de SAP</h1>
        <p className="text-sm text-azul/60">
          Aquí se suben los reportes que SAP produce. De ellos salen los pedidos que el ingreso
          encuentra al escanear y los camiones que el despacho abre con el tabulado.
        </p>
      </header>

      <DatosForm />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm text-azul/60">Última subida de cada reporte</h2>
        <ul className="flex flex-col divide-y divide-borde text-sm">
          {(Object.keys(NOMBRE) as Reporte[]).map((kind) => {
            const c = porKind.get(kind)
            return (
              <li key={kind} className="flex items-baseline gap-3 py-2">
                <span className="min-w-0 flex-1">{NOMBRE[kind]}</span>
                {c ? (
                  <>
                    <span className="shrink-0 tabular-nums text-azul/60">
                      {plural(c.rows_read ?? 0, 'fila', 'filas')}
                    </span>
                    <span className="w-28 shrink-0 text-right tabular-nums">
                      {cuando(c.uploaded_at)}
                    </span>
                  </>
                ) : (
                  <span className="shrink-0 text-azul/60">Nunca</span>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    </main>
  )
}
