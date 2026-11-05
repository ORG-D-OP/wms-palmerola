import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/roles'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { TurnoForm, type Equipo } from './turno-form'
import { Flota } from './flota'

export const metadata = { title: 'Turno · WMS Palmerola' }

export default async function TurnoPage() {
  const user = await requirePermission('turno:iniciar')
  const supabase = await createSupabaseServerClient()

  const [{ data: turnos }, { data: equipos }, { data: tipos }] = await Promise.all([
    supabase
      .from('shift_assignment')
      .select('started_at, flow, equipment(code, equipment_type(name, max_level))')
      .is('ended_at', null)
      .eq('profile_id', user.id),
    supabase
      .from('equipment')
      .select('id, code, equipment_type(name, max_level), shift_assignment(ended_at)')
      .eq('is_active', true)
      .order('code'),
    supabase.from('equipment_type').select('code, name, max_level').eq('is_active', true),
  ])

  const abierto = turnos?.[0]
  const turno = abierto
    ? {
        equipo: abierto.equipment?.code ?? null,
        tipo: abierto.equipment?.equipment_type?.name ?? null,
        alcance: abierto.equipment?.equipment_type?.max_level ?? 0,
        flujo: abierto.flow,
        desde: abierto.started_at,
      }
    : null

  const flota: Equipo[] = (equipos ?? []).map((e) => ({
    id: e.id,
    code: e.code,
    tipo: e.equipment_type?.name ?? '',
    alcance: e.equipment_type?.max_level ?? 0,
    libre: !e.shift_assignment.some((s) => s.ended_at === null),
  }))

  return (
    <main className="flex w-full max-w-md flex-1 flex-col gap-6 p-4 pb-8">
      <h1 className="text-xl">Mi turno</h1>
      <TurnoForm turno={turno} equipos={flota} />

      {can(user.role, 'flota:administrar') ? (
        <Flota
          equipos={flota}
          tipos={(tipos ?? []).map((t) => ({
            code: t.code,
            name: t.name,
            alcance: t.max_level,
          }))}
        />
      ) : null}
    </main>
  )
}
