import { requirePermission } from '@/lib/auth/session'
import { rolDe } from '@/lib/auth/roles'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Aviso } from '@/components/ui/feedback'
import { Lista, type Correo, type Persona } from './lista'

export const metadata = { title: 'Personal · WMS Palmerola' }

export default async function PersonalPage() {
  await requirePermission('personal:administrar')
  const supabase = await createSupabaseServerClient()

  const [{ data: filas, error }, { data: correos }] = await Promise.all([
    supabase.rpc('listar_personal'),
    supabase.rpc('listar_correos'),
  ])

  if (error) {
    return (
      <main className="flex flex-1 flex-col gap-6 p-4 pb-8">
        <Aviso>No se pudo leer el personal: {error.message}</Aviso>
      </main>
    )
  }

  const gente: Persona[] = (filas ?? []).map((f) => ({
    id: f.id,
    nombre: f.full_name,
    identidad: f.employee_code,
    correo: f.email,
    rol: rolDe(f.role),
    rolesExtra: (f.roles_extra ?? []).map(rolDe),
    activa: f.is_active,
    aceptada: f.approved_at !== null,
    registrada: f.created_at,
  }))

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 pb-8">
      <div>
        <h1 className="text-xl">Personal</h1>
        <p className="text-sm text-azul/60">
          Quién puede entrar al sistema y qué le toca hacer.
        </p>
      </div>

      <Lista
        pendientes={gente.filter((p) => !p.aceptada)}
        dentro={gente.filter((p) => p.aceptada && p.activa)}
        fuera={gente.filter((p) => p.aceptada && !p.activa)}
        correos={(correos ?? []) as Correo[]}
      />
    </main>
  )
}
