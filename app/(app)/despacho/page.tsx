import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/roles'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { DespachoForm, type Abierto, type PorCargar } from './despacho-form'
import { recargarDespacho } from './actions'

export const metadata = { title: 'Despacho · WMS Palmerola' }

/**
 * Cuántos camiones por cargar se listan.
 *
 * El respaldo de SAP trae todo lo que no ha salido —hoy pasan de seiscientos— y eso no es una
 * cola de trabajo: la cola son los de estos días. El que busque uno más viejo escanea su
 * hoja, que para eso está la caja de arriba. Es el mismo número que en Ingreso y por lo mismo.
 */
const POR_CARGAR = 25

/** Repartido, surtiéndose o surtido: lo que hay a medias en los andenes ahora mismo. */
const ABIERTOS = ['RELEASED', 'PICKING', 'PICKED'] as const

/**
 * La hoja de despacho, hermana de la de ingreso, y la ve la misma gente: quien está en el
 * andén escanea el tabulado y va sacando. Lo que no es de todos es **el chequeo**: marcar
 * una línea, corregir la cantidad y cerrar el camión lo hace quien tiene la hoja en la mano
 * y compara, el chequeador. Los demás ven la hoja para saber qué cargar.
 */
export default async function DespachoPage() {
  const user = await requirePermission('inventario:mover')

  // Los camiones que vienen de SAP llegan sin andén: el Excel no lo trae. La lista va aquí
  // para que la pantalla lo pueda preguntar sin otra vuelta al servidor.
  const supabase = await createSupabaseServerClient()
  const [{ data: andenes }, { data: enCurso }, { data: medias }, { data: esperando }] =
    await Promise.all([
      supabase.from('anden_de_carga').select('anden').order('anden'),
      supabase.rpc('despacho_en_curso'),
      // Los que están a medias, de quien sea. La pantalla era una caja de escaneo y nada más:
      // para seguir con el camión del compañero había que tener su hoja en la mano. Es lo que
      // Ingreso tiene y aquí faltaba.
      supabase
        .from('despacho_progreso')
        .select('id, code, transporte, anden, lineas, pedido, surtido, pendientes')
        .in('status', ABIERTOS),
      // Y los que SAP mandó y nadie ha abierto, del último que apareció hacia atrás.
      supabase
        .from('despacho_progreso')
        .select('id, code, transporte, customer, lineas')
        .eq('status', 'DRAFT')
        .order('created_at', { ascending: false })
        .limit(POR_CARGAR),
    ])

  // El camión que se está cargando en su andén vuelve puesto: nadie tiene que buscar la hoja
  // otra vez por haber salido un momento de la pantalla.
  const abierto = enCurso ? await recargarDespacho(enCurso) : null

  return (
    <main className="flex w-full max-w-md flex-1 flex-col gap-6 p-4 pb-8 md:p-8">
      <h1 className="text-xl">Despachar camión</h1>
      <DespachoForm
        deAnden={can(user.roles, 'despachos:administrar')}
        abierto={abierto?.ok ? abierto.camion : null}
        anden={user.anden}
        andenes={(andenes ?? []).map((a) => a.anden).filter((a): a is string => a !== null)}
        abiertos={(medias ?? [])
          .map(
            (m): Abierto => ({
              id: m.id!,
              code: m.transporte ?? m.code!,
              anden: m.anden,
              lineas: m.lineas ?? 0,
              pedido: Number(m.pedido ?? 0),
              surtido: Number(m.surtido ?? 0),
            }),
          )
          // El de su andén primero: es el que casi siempre viene a buscar.
          .sort((a, b) => Number(b.anden === user.anden) - Number(a.anden === user.anden))}
        porCargar={(esperando ?? []).map(
          (c): PorCargar => ({
            id: c.id!,
            code: c.transporte ?? c.code!,
            cliente: c.customer,
            lineas: c.lineas ?? 0,
          }),
        )}
      />
    </main>
  )
}
