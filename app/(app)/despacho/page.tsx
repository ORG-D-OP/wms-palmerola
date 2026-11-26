import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/roles'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { DespachoForm } from './despacho-form'
import { recargarDespacho } from './actions'

export const metadata = { title: 'Despacho · WMS Palmerola' }

/**
 * La hoja de despacho, hermana de la de ingreso, y la ve la misma gente: quien está en el
 * andén escanea el tabulado y va sacando. Lo único que no es de todos es **cerrar el
 * camión**, que es el momento en que el producto sale del inventario: eso lo hace quien
 * tiene la hoja en la mano y verifica, el chequeador.
 */
export default async function DespachoPage() {
  const user = await requirePermission('inventario:mover')

  // Los camiones que vienen de SAP llegan sin andén: el Excel no lo trae. La lista va aquí
  // para que la pantalla lo pueda preguntar sin otra vuelta al servidor.
  const supabase = await createSupabaseServerClient()
  const [{ data: andenes }, { data: enCurso }] = await Promise.all([
    supabase.from('anden_de_carga').select('anden').order('anden'),
    supabase.rpc('despacho_en_curso'),
  ])

  // El camión que se está cargando en su andén vuelve puesto: nadie tiene que buscar la hoja
  // otra vez por haber salido un momento de la pantalla.
  const abierto = enCurso ? await recargarDespacho(enCurso) : null

  return (
    <main className="flex w-full max-w-md flex-1 flex-col gap-6 p-4 pb-8 md:p-8">
      <h1 className="text-xl">Despachar camión</h1>
      <DespachoForm
        puedeCerrar={can(user.roles, 'despachos:administrar')}
        abierto={abierto?.ok ? abierto.camion : null}
        andenes={(andenes ?? []).map((a) => a.anden).filter((a): a is string => a !== null)}
      />
    </main>
  )
}
