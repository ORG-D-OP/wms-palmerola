import { requirePermission } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Icon } from '@/components/ui/icon'
import { CAMPO } from '@/components/ui/campos'
import { BotonCamara } from '@/components/ui/boton-camara'
import { Cambios } from './cambios'
import { Plano } from './plano'

export const metadata = { title: 'Áreas · WMS Palmerola' }

const TOPE = 6000

/** Los niveles que hay: el 0 es el piso y de ahí para arriba los del rack. */
const NIVELES = [0, 1, 2, 3, 4, 5, 6]

/** Las clases de zona, dichas como las dice la bodega. */
const CLASES: Record<string, string> = {
  floor: 'Todo el piso',
  rack: 'Todos los racks',
  staging: 'Los andenes',
  quarantine: 'Cuarentena',
  returns: 'Devoluciones',
}

type Resumen = { clave: string; nombre: string; n: number }

function contar(filas: { clave: string; nombre: string }[]): Resumen[] {
  const mapa = new Map<string, Resumen>()
  for (const f of filas) {
    const r = mapa.get(f.clave) ?? { clave: f.clave, nombre: f.nombre, n: 0 }
    r.n++
    mapa.set(f.clave, r)
  }
  return [...mapa.values()].sort((a, b) => b.n - a.n)
}

/**
 * Las áreas y los usos son datos, no estructura: el picking nació vacío porque nadie sabe
 * todavía cuáles posiciones se van a surtir a mano, y hay posiciones que no guardan
 * producto. Esta pantalla es la única forma de declararlo sin tocar la base.
 *
 * El rango se dice por tres criterios que se cruzan —el código, la zona y el nivel—, porque
 * así se habla de la bodega: «la primera columna de F1» es el código F1-001, «el piso bajo de
 * los racks» es zona rack y nivel 1, «todo el piso» es la clase piso. Y porque esto no se
 * declara una vez y ya: la planimetría y el ABC cambian seguido, así que redibujar el picking
 * es mantenimiento. Primero se cuenta lo que el rango agarra, y sólo después se cambia.
 */
export default async function AreasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; zona?: string; nivel?: string }>
}) {
  await requirePermission('areas:administrar')
  const { q = '', zona = '', nivel = '' } = await searchParams
  const patron = q.trim().toUpperCase()
  const supabase = await createSupabaseServerClient()

  const [{ data: areas }, { data: usos }, { data: ocupacion }, { data: zonas }] =
    await Promise.all([
      supabase.from('area').select('code, name, type_code').eq('is_active', true).order('code'),
      supabase
        .from('location_usage')
        .select('code, name')
        .eq('is_active', true)
        .order('sort_order'),
      supabase
        .from('area_occupancy')
        .select('code, name, total, ocupadas, is_virtual')
        .order('code'),
      supabase.from('zone').select('code, name, kind').order('code'),
    ])

  const clases = [...new Set((zonas ?? []).map((z) => z.kind))].sort()
  const criterios = (patron.length >= 3 ? 1 : 0) + (zona ? 1 : 0) + (nivel ? 1 : 0)

  let consulta = supabase
    .from('posicion_detalle')
    .select('code, area_code, area_name, usage_code, usage_name, ocupada, apartada, level')
    .order('code')
    .limit(TOPE)
  if (patron.length >= 3) consulta = consulta.like('code', `${patron}%`)
  const clase = clases.find((k) => k === zona)
  if (zona) {
    consulta = clase ? consulta.eq('zone_kind', clase) : consulta.eq('zone_code', zona)
  }
  if (nivel) consulta = consulta.eq('level', Number(nivel))

  const { data: alcance } = criterios > 0 ? await consulta : { data: null }

  const filas = alcance ?? []
  const porArea = contar(
    filas.map((f) => ({ clave: f.area_code ?? 'SIN', nombre: f.area_name ?? 'Sin área' })),
  )
  const porUso = contar(
    filas.map((f) => ({ clave: f.usage_code ?? '', nombre: f.usage_name ?? '' })),
  )
  const ocupadas = filas.filter((f) => f.ocupada).length

  return (
    <main className="flex w-full max-w-2xl flex-1 flex-col gap-6 p-4 pb-8">
      <div>
        <h1 className="text-xl">Áreas y usos</h1>
        <p className="text-sm text-azul/60">
          Aquí se define qué parte de la bodega es picking y cuáles posiciones no guardan
          producto. El motor de ubicación obedece esto.
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg">Cómo está hoy</h2>
        <ul className="flex flex-col divide-y divide-borde">
          {(ocupacion ?? []).map((a) => (
            <li key={a.code} className="flex items-baseline justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate">{a.name}</span>
                {a.is_virtual ? (
                  <span className="text-xs text-azul/50">área virtual, sin posiciones físicas</span>
                ) : null}
              </span>
              <span className="shrink-0 text-sm tabular-nums text-azul/70">
                {(a.total ?? 0).toLocaleString('es-HN')} posiciones
                {(a.ocupadas ?? 0) > 0 ? ` · ${a.ocupadas} con producto` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg">Cambiar un rango</h2>
        <Plano seleccionado={filas[0]?.code ?? undefined} />
        <form className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              name="q"
              defaultValue={q}
              placeholder="F1-001 o R-ABA-L01, varios con coma"
              className={`${CAMPO} flex-1`}
            />
            <BotonCamara campo="q" enviar />
            <button
              aria-label="Contar"
              className="flex h-14 items-center rounded-xl bg-azul px-4 text-white"
            >
              <Icon name="search" />
            </button>
          </div>
          <div className="flex gap-2">
            <select name="zona" defaultValue={zona} className={`${CAMPO} flex-1`}>
              <option value="">Toda la bodega</option>
              {clases.map((k) => (
                <option key={k} value={k}>
                  {CLASES[k] ?? k}
                </option>
              ))}
              {(zonas ?? []).map((z) => (
                <option key={z.code} value={z.code}>
                  {z.code} · {z.name}
                </option>
              ))}
            </select>
            <select name="nivel" defaultValue={nivel} className={`${CAMPO} flex-1`}>
              <option value="">Cualquier nivel</option>
              {NIVELES.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'Piso' : `Nivel ${n}`}
                </option>
              ))}
            </select>
          </div>
        </form>

        {criterios === 0 ? (
          <p className="text-sm text-azul/60">
            Escanea la etiqueta del lugar, escribe el principio del código —F1 es ese bloque
            entero, F1-001 la primera línea, R-ABA-L01 el primer carril de abarrotes, y varios
            separados por coma— o elige zona y nivel: «todos los racks» más «nivel 1» es el piso
            bajo de todos los racks.
          </p>
        ) : patron.length > 0 && patron.length < 3 ? (
          <p className="text-sm text-azul/60">Escribe al menos tres caracteres.</p>
        ) : filas.length === 0 ? (
          <p className="text-azul/60">Ninguna posición cumple eso.</p>
        ) : (
          <>
            <div className="rounded-2xl border border-borde p-4">
              <p className="text-2xl tabular-nums">
                {filas.length.toLocaleString('es-HN')} posiciones
              </p>
              <p className="text-sm text-azul/60">
                de {filas[0]?.code} a {filas[filas.length - 1]?.code}
                {ocupadas > 0 ? ` · ${ocupadas} con producto` : ''}
              </p>
              <dl className="mt-3 flex flex-col gap-1 text-sm">
                <div className="flex gap-2">
                  <dt className="text-azul/60">Área:</dt>
                  <dd>{porArea.map((a) => `${a.nombre} (${a.n})`).join(', ')}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-azul/60">Uso:</dt>
                  <dd>{porUso.map((u) => `${u.nombre} (${u.n})`).join(', ')}</dd>
                </div>
              </dl>
            </div>

            <Cambios
              patron={patron}
              zona={zona}
              nivel={nivel}
              areas={(areas ?? []).map((a) => ({ code: a.code, name: a.name }))}
              usos={(usos ?? []).map((u) => ({ code: u.code, name: u.name }))}
            />

            {ocupadas > 0 ? (
              <p className="text-sm text-azul/70">
                El uso no se puede cambiar mientras haya producto encima: esas {ocupadas}{' '}
                posiciones hay que vaciarlas primero.
              </p>
            ) : null}
          </>
        )}
      </section>
    </main>
  )
}
