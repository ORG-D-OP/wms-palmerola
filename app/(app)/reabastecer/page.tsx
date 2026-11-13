import { requirePermission } from '@/lib/auth/session'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { textoCajas } from '@/lib/cajas'
import { plural } from '@/lib/plural'
import { Icon } from '@/components/ui/icon'
import { Umbral } from './umbral'

export const metadata = { title: 'Reabastecer · WMS Palmerola' }

/** Con una posición por producto son unos cientos; más que eso no se lee, se barre. */
const TOPE = 200

/**
 * El aviso de reabastecimiento.
 *
 * No hay olas: no se sabe de antemano qué pedidos van a caer mañana, así que lanzar el
 * reabastecimiento sigue siendo del jefe. Lo que el sistema hace es avisarle antes de que una
 * posición de picking se quede en nada, y decirle de dónde sacarlo —el pallet que primero
 * vence, como manda FEFO—.
 *
 * El movimiento se hace en `/reordenar`, que ya pide los dos escaneos.
 */
export default async function ReabastecerPage() {
  await requirePermission('reabastecimiento:lanzar')
  const supabase = await createSupabaseServerClient()

  const [{ data: bajas }, { data: area }] = await Promise.all([
    supabase.from('picking_bajo').select('*').limit(TOPE),
    supabase.from('area').select('code, replenish_pct').eq('code', 'PICKING').maybeSingle(),
  ])

  const filas = bajas ?? []
  const pct = area?.replenish_pct ?? 50

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-8 md:max-w-3xl">
      <h1 className="text-xl">Reabastecer picking</h1>

      <Umbral area={area?.code ?? 'PICKING'} pct={pct} />

      {filas.length === 0 ? (
        <p className="text-azul/60">
          Ninguna posición de picking está por debajo del {pct}%. No hay nada que reabastecer.
        </p>
      ) : (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg">
            {plural(filas.length, 'posición', 'posiciones')} por debajo del {pct}%
          </h2>
          <p className="text-sm text-azul/70">
            De arriba hacia abajo, la que peor está primero. El movimiento se hace en Reordenar:
            se escanea de dónde sale y a dónde va.
          </p>

          <ul className="flex flex-col divide-y divide-borde">
            {filas.map((f) => (
              <li key={`${f.posicion}-${f.sku}`} className="flex flex-col gap-1.5 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <span className="tabular-nums">{f.posicion}</span>
                    <span className="text-azul/60"> · {f.sku}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">{f.pct}%</span>
                </div>

                <span className="truncate text-sm text-azul/60">{f.producto}</span>

                <div
                  className="h-1.5 overflow-hidden rounded-full bg-azul-08"
                  role="img"
                  aria-label={`${f.pct}% de lo que cabe`}
                >
                  <div className="h-full bg-azul" style={{ width: `${f.pct}%` }} />
                </div>

                <span className="text-sm text-azul/70">
                  {Number(f.disponible ?? 0) > 0
                    ? `Le quedan ${textoCajas(
                        Number(f.disponible ?? 0),
                        Number(f.por_caja ?? 1),
                      )} de ${textoCajas(Number(f.tope ?? 0), Number(f.por_caja ?? 1))}`
                    : f.ocupada_por
                      ? `Sin producto, y caben ${textoCajas(
                          Number(f.tope ?? 0),
                          Number(f.por_caja ?? 1),
                        )}`
                      : `Está vacía, y caben ${textoCajas(
                          Number(f.tope ?? 0),
                          Number(f.por_caja ?? 1),
                        )}`}
                </span>

                {/*
                  Decía «está vacía» de una posición que tenía otro producto, y el viaje lo
                  rechazaba después el propio escaneo del destino. Si la tiene otro, se nombra:
                  eso es lo que hay que resolver antes de mover nada.
                */}
                {f.ocupada_por ? (
                  <span className="flex items-center gap-1.5 text-sm text-rojo">
                    <Icon name="error" className="!text-[18px]" />
                    La posición la tiene {f.ocupada_por}: hay que sacarlo primero
                  </span>
                ) : null}

                {f.sacar_de ? (
                  <span className="flex items-center gap-1.5 text-sm">
                    <Icon name="moving" className="!text-[18px] text-azul/60" />
                    Sácalo de <span className="tabular-nums">{f.sacar_de}</span>
                    {f.vence_origen ? (
                      <span className="text-azul/60">· vence {f.vence_origen}</span>
                    ) : null}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-sm text-rojo">
                    <Icon name="error" className="!text-[18px]" />
                    No hay de este producto en almacén
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
