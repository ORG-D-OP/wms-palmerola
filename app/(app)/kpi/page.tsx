import { requirePermission } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { plural } from '@/lib/plural'

export const metadata = { title: 'Indicadores · WMS Palmerola' }

/** Dos semanas es lo que se mira de un vistazo; el resto es historia. */
const DIAS = 14

const numero = (n: number | null, decimales = 0) =>
  n === null ? '—' : n.toLocaleString('es-HN', { maximumFractionDigits: decimales })

const fecha = (dia: string) =>
  new Date(`${dia}T12:00:00Z`).toLocaleDateString('es-HN', { day: 'numeric', month: 'short' })

/**
 * Los números que los gerentes quieren ver.
 *
 * Tres, y los tres explicados en la misma línea: **precisión** de los despachos —cuántos
 * camiones salieron completos—, **cajas por hora** contra la hora del turno, que es la que se
 * paga, y el **tiempo improductivo**, que es lo que hace que la cifra de arriba se pueda
 * explicar en vez de sólo compararse.
 *
 * El desglose por persona va aparte, en una función que exige el rango: los números de cada
 * quien no los ve cualquiera. Y dice cuántos de sus turnos los cerró el sistema, porque esas
 * horas son un cálculo: sin eso, un número bajo no se distingue de un turno olvidado.
 */
export default async function KpiPage() {
  await requirePermission('kpi:ver')
  const supabase = await createSupabaseServerClient()

  const [{ data: dias }, { data: personas }] = await Promise.all([
    supabase.from('kpi_dia').select('*').limit(DIAS),
    supabase.rpc('kpi_por_persona'),
  ])

  const filas = dias ?? []
  const hoy = filas[0]
  const gente = personas ?? []

  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-8">
      <h1 className="text-xl">Indicadores</h1>

      {!hoy ? (
        <p className="text-azul/60">
          Todavía no hay nada que medir: ni tareas terminadas ni camiones despachados.
        </p>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-lg">Último día con movimiento · {fecha(hoy.dia!)}</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Cifra
                titulo="Cajas por hora"
                valor={numero(num(hoy.cajas_por_hora), 1)}
                pie={
                  num(hoy.cajas_por_hora) === null
                    ? 'sin turno registrado'
                    : `${numero(num(hoy.cajas))} cajas en ${numero(num(hoy.horas_turno), 1)} h`
                }
              />
              <Cifra
                titulo="Precisión"
                valor={num(hoy.precision_pct) === null ? '—' : `${numero(num(hoy.precision_pct))}%`}
                pie={
                  num(hoy.camiones) === 0
                    ? 'sin camiones despachados'
                    : `${numero(num(hoy.completos))} de ${numero(num(hoy.camiones))} camiones completos`
                }
              />
              <Cifra
                titulo="Improductivo"
                valor={
                  num(hoy.improductivo_pct) === null
                    ? '—'
                    : `${numero(num(hoy.improductivo_pct))}%`
                }
                pie="del turno, fuera de tarea"
              />
              <Cifra
                titulo="Tareas"
                valor={numero(num(hoy.tareas))}
                pie={`${numero(num(hoy.personas))} ${num(hoy.personas) === 1 ? 'persona' : 'personas'}`}
              />
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg">Los últimos días</h2>
            <ul className="flex flex-col divide-y divide-borde">
              {filas.map((f) => (
                <li key={f.dia} className="flex items-baseline gap-3 py-2 text-sm">
                  <span className="w-16 shrink-0 text-azul/60">{fecha(f.dia!)}</span>
                  <span className="flex-1 tabular-nums">
                    {numero(num(f.cajas))} cajas · {numero(num(f.tareas))} tareas
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {num(f.cajas_por_hora) === null ? '—' : `${numero(num(f.cajas_por_hora), 1)}/h`}
                  </span>
                  <span className="w-14 shrink-0 text-right tabular-nums text-azul/60">
                    {num(f.precision_pct) === null ? '—' : `${numero(num(f.precision_pct))}%`}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-azul/60">
              A la derecha, cajas por hora y precisión de los despachos de ese día.
            </p>
          </section>
        </>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg">Por persona, la última semana</h2>
        {gente.length === 0 ? (
          <p className="text-sm text-azul/60">Nadie ha trabajado en estos siete días.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-borde">
            {gente.map((p) => {
              const anden = Number(p.lineas_chequeadas ?? 0) + Number(p.pallets_recibidos ?? 0)
              const soloAnden = anden > 0 && Number(p.tareas ?? 0) === 0
              return (
              <li key={p.profile_id} className="flex flex-col gap-1 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">{p.nombre}</span>
                  <span className="shrink-0 tabular-nums">
                    {num(p.cajas_por_hora) === null
                      ? '—'
                      : `${numero(num(p.cajas_por_hora), 1)} cajas/h`}
                  </span>
                </div>
                <span className="text-sm text-azul/60 tabular-nums">
                  {numero(num(p.tareas))} tareas · {numero(num(p.cajas))} cajas ·{' '}
                  {numero(num(p.horas_turno), 1)} h de turno
                  {num(p.improductivo_pct) === null
                    ? ''
                    : ` · ${numero(num(p.improductivo_pct))}% improductivo`}
                </span>
                {anden > 0 ? (
                  <span className="text-sm text-azul/60 tabular-nums">
                    En el andén:{' '}
                    {plural(Number(p.lineas_chequeadas), 'línea chequeada', 'líneas chequeadas')} ·{' '}
                    {plural(Number(p.pallets_recibidos), 'pallet recibido', 'pallets recibidos')}
                  </span>
                ) : null}
                {soloAnden ? (
                  <span className="text-xs text-azul/60">
                    Trabajó el andén: lo suyo se mide en lo que chequea y recibe, no en tareas ni
                    en cajas por hora.
                  </span>
                ) : null}
                {Number(p.turnos_calculados ?? 0) > 0 ? (
                  <span className="text-xs text-azul/60">
                    El sistema cerró {plural(Number(p.turnos_calculados), 'turno', 'turnos')} que
                    nadie cerró al irse: esas horas son un cálculo.
                  </span>
                ) : null}
              </li>
              )
            })}
          </ul>
        )}
      </section>
    </main>
  )
}

function Cifra({ titulo, valor, pie }: { titulo: string; valor: string; pie: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-2xl border border-borde p-4">
      <span className="text-sm text-azul/60">{titulo}</span>
      <span className="text-3xl tabular-nums">{valor}</span>
      <span className="text-xs text-azul/60">{pie}</span>
    </div>
  )
}
