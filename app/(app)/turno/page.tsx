import { requirePermission } from '@/lib/auth/session'
import { can, rolDe, rolesDeTrabajoDe } from '@/lib/auth/roles'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { SwitchTeclado } from '@/components/ui/teclado'
import { TurnoForm, type Tipo } from './turno-form'
import { Reparto, type Carga, type Persona } from './reparto'

export const metadata = { title: 'Disponibilidad · WMS Palmerola' }

export default async function TurnoPage() {
  const user = await requirePermission('turno:iniciar')
  const supabase = await createSupabaseServerClient()

  const reparte = can(user.roles, 'tareas:reasignar')

  const [{ data: turnos }, { data: tipos }, { data: gente }, { data: puertas }] =
    await Promise.all([
      supabase
        .from('shift_assignment')
        .select(
          'started_at, paused_at, pause_note, working_role, dock_door(code), equipment_type(code, name, max_level)',
        )
        .is('ended_at', null)
        .eq('profile_id', user.id),
      supabase.from('equipment_type').select('code, name, max_level').eq('is_active', true),
      reparte
        ? supabase
            .from('disponibles')
            .select('id, full_name, role, rol_trabajo, disponible, pause_note, anden')
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
        rol: rolDe(abierto.working_role ?? user.role),
        tipo: abierto.equipment_type?.name ?? null,
        alcance: abierto.equipment_type?.max_level ?? 0,
        desde: abierto.started_at,
        pausado: abierto.paused_at !== null,
        motivo: abierto.pause_note,
        anden: abierto.dock_door?.code ?? null,
      }
    : null

  return (
    <main className="flex w-full max-w-md flex-1 flex-col gap-6 p-4 pb-8">
      <h1 className="text-xl">Disponibilidad</h1>
      <TurnoForm
        turno={turno}
        tipos={(tipos ?? []).map((t): Tipo => ({ code: t.code, name: t.name, alcance: t.max_level }))}
        rango={rolDe(user.role)}
        roles={rolesDeTrabajoDe(user.roles)}
      />

      <SwitchTeclado />

      {reparte ? (
        <Reparto
          gente={(gente ?? []).map(
            (p): Persona => ({
              id: p.id ?? '',
              nombre: p.full_name ?? '',
              // Lo que el jefe reparte es trabajo, así que lo que le importa es el rol con
              // el que cada quien está trabajando ahora, no su rango.
              rol: rolDe(p.rol_trabajo ?? p.role),
              disponible: p.disponible ?? false,
              motivo: p.pause_note,
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
    </main>
  )
}
