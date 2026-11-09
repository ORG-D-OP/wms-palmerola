import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/roles'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { TurnoForm, type Equipo } from './turno-form'
import { Flota } from './flota'
import { Reparto, type Carga, type Persona } from './reparto'

export const metadata = { title: 'Disponibilidad · WMS Palmerola' }

export default async function TurnoPage() {
  const user = await requirePermission('turno:iniciar')
  const supabase = await createSupabaseServerClient()

  const reparte = can(user.role, 'tareas:reasignar')

  const [{ data: turnos }, { data: equipos }, { data: tipos }, { data: gente }, { data: puertas }] =
    await Promise.all([
      supabase
        .from('shift_assignment')
        .select(
          'started_at, paused_at, pause_note, dock_door(code), equipment(code, equipment_type(name, max_level))',
        )
        .is('ended_at', null)
        .eq('profile_id', user.id),
      supabase
        .from('equipment')
        .select('id, code, equipment_type(name, max_level), shift_assignment(ended_at)')
        .eq('is_active', true)
        .order('code'),
      supabase.from('equipment_type').select('code, name, max_level').eq('is_active', true),
      reparte
        ? supabase
            .from('disponibles')
            .select('id, full_name, role, disponible, pause_note, equipo, anden')
            .order('full_name')
        : { data: null },
      reparte
        ? supabase
            .from('carga_por_anden')
            .select('anden, libres, asignadas, en_curso, personas')
            .order('anden')
        : { data: null },
    ])

  const abierto = turnos?.[0]
  const turno = abierto
    ? {
        equipo: abierto.equipment?.code ?? null,
        tipo: abierto.equipment?.equipment_type?.name ?? null,
        alcance: abierto.equipment?.equipment_type?.max_level ?? 0,
        desde: abierto.started_at,
        pausado: abierto.paused_at !== null,
        motivo: abierto.pause_note,
        anden: abierto.dock_door?.code ?? null,
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
      <h1 className="text-xl">Disponibilidad</h1>
      <TurnoForm turno={turno} equipos={flota} />

      {reparte ? (
        <Reparto
          gente={(gente ?? []).map(
            (p): Persona => ({
              id: p.id ?? '',
              nombre: p.full_name ?? '',
              rol: p.role ?? 'solo_lectura',
              disponible: p.disponible ?? false,
              motivo: p.pause_note,
              equipo: p.equipo,
              anden: p.anden,
            }),
          )}
          carga={(puertas ?? []).map(
            (c): Carga => ({
              anden: c.anden ?? '',
              libres: c.libres ?? 0,
              asignadas: c.asignadas ?? 0,
              enCurso: c.en_curso ?? 0,
              personas: c.personas ?? 0,
            }),
          )}
        />
      ) : null}

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
