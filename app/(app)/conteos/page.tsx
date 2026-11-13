import { requirePermission } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Lanzar, type Opcion } from './lanzar'
import { plural } from '@/lib/plural'
import { textoCajas } from '@/lib/cajas'

export const metadata = { title: 'Conteos · WMS Palmerola' }

const NIVELES = [0, 1, 2, 3, 4, 5, 6]

/** Las clases de zona, dichas como las dice la bodega. Igual que en Áreas. */
const CLASES: Record<string, string> = {
  floor: 'Todo el piso',
  rack: 'Todos los racks',
  staging: 'Los andenes',
  quarantine: 'Cuarentena',
  returns: 'Devoluciones',
}

/**
 * La diferencia en cajas y sueltas, que es como se cuenta en la bodega.
 *
 * Partida en dos, no en un decimal: en picking casi nunca sobra o falta un número redondo de
 * cajas, y «-20.21 cajas» no le dice nada a nadie.
 */
const diferencia = (r: { diferencia: number | null; por_caja: number | null }) => {
  const unidades = Number(r.diferencia ?? 0)
  if (unidades === 0) return 'cuadra'
  return `${unidades > 0 ? '+' : '-'}${textoCajas(Math.abs(unidades), Number(r.por_caja || 1))}`
}

const fecha = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('es-HN', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''

/**
 * El panel del conteo cíclico: lanzarlo, ver lo que está abierto y ver quién falla.
 *
 * El porcentaje de inexactitud es por persona a propósito: es para saber a quién hay que
 * acompañar, no para castigar. Salen los dos números porque dicen cosas distintas —cuántas
 * veces encontró un descuadre, y de qué tamaño eran.
 */
export default async function ConteosPage() {
  await requirePermission('conteo:lanzar')
  const supabase = await createSupabaseServerClient()

  const [{ data: zonas }, { data: areas }, { data: abiertos }, { data: gente }, { data: ultimos }] =
    await Promise.all([
      supabase.from('zone').select('code, name, kind').order('code'),
      supabase.from('area').select('code, name').eq('is_active', true).order('code'),
      supabase.from('conteos_pendientes').select('task_id, posicion, assigned_to, status'),
      supabase.from('inexactitud').select('*').order('conteos', { ascending: false }),
      supabase
        .from('recuentos')
        .select('id, counted_at, persona, posicion, sku, diferencia, por_caja')
        .order('counted_at', { ascending: false })
        .limit(20),
    ])

  const porZona: Opcion[] = (zonas ?? []).map((z) => ({
    valor: z.code ?? '',
    nombre: z.name ?? z.code ?? '',
  }))
  // Una clase que sólo tiene una zona sale dos veces con el mismo nombre —«Cuarentena» como
  // clase y como zona—, y el que escoge no sabe cuál es cuál. Sólo vale la pena decir «todos
  // los racks» cuando hay más de uno.
  const porClase: Opcion[] = [...new Set((zonas ?? []).map((z) => z.kind))].flatMap((k) => {
    const nombre = k ? CLASES[k] : undefined
    const cuantas = (zonas ?? []).filter((z) => z.kind === k).length
    return k && nombre && cuantas > 1 ? [{ valor: k, nombre }] : []
  })

  const pendientes = abiertos ?? []
  const sinDueno = pendientes.filter((t) => !t.assigned_to).length

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-8 md:max-w-3xl">
      <h1 className="text-xl">Conteos cíclicos</h1>

      <Lanzar
        zonas={[...porClase, ...porZona]}
        areas={(areas ?? []).map((a) => ({ valor: a.code ?? '', nombre: a.name ?? a.code ?? '' }))}
        niveles={NIVELES}
      />

      {pendientes.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg">Abierto ahora</h2>
          <p className="text-sm text-azul/70">
            {plural(pendientes.length, 'posición', 'posiciones')} por
            contar
            {sinDueno > 0 ? `, ${sinDueno} esperando en la cola` : ', todas repartidas'}.
          </p>
        </section>
      ) : null}

      {(gente ?? []).length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg">Inexactitud por persona</h2>
          <ul className="flex flex-col divide-y divide-borde text-sm">
            {(gente ?? []).map((g) => (
              <li key={g.profile_id} className="flex items-baseline gap-3 py-2">
                <span className="min-w-0 flex-1 truncate">{g.persona ?? 'Sin nombre'}</span>
                <span className="shrink-0 tabular-nums text-azul/60">
                  {g.descuadres} de {g.conteos}
                </span>
                <span className="w-16 shrink-0 text-right tabular-nums">
                  {Number(g.pct_conteos_con_descuadre ?? 0)}%
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-azul/50">
            Cuántos de sus conteos no cuadraron. La columna del medio es descuadres sobre
            conteos.
          </p>
        </section>
      ) : null}

      {(ultimos ?? []).length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg">Últimos recuentos</h2>
          <ul className="flex flex-col divide-y divide-borde text-sm">
            {(ultimos ?? []).map((r) => (
              <li key={r.id} className="flex items-baseline gap-3 py-2">
                <span className="w-24 shrink-0 tabular-nums text-azul/60">
                  {fecha(r.counted_at)}
                </span>
                <span className="w-24 shrink-0 tabular-nums">{r.posicion}</span>
                <span className="min-w-0 flex-1 truncate text-azul/60">
                  {r.sku} · {r.persona ?? ''}
                </span>
                <span className="shrink-0 tabular-nums">{diferencia(r)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  )
}
