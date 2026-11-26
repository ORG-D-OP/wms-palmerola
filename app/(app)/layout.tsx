import Image from 'next/image'
import { requireUser } from '@/lib/auth/session'
import { ROLE_LABELS } from '@/lib/auth/roles'
import { navAgrupado, navMovil } from '@/components/app-shell/nav-items'
import { BottomNav } from '@/components/app-shell/bottom-nav'
import { SideNav } from '@/components/app-shell/side-nav'
import { Icon } from '@/components/ui/icon'
import { nombrePosicion } from '@/lib/posiciones'
import { logout } from '@/app/(public)/login/actions'

const BOTON_SALIR =
  'flex size-10 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/15 hover:text-white'

function Pastilla({ icono, children }: { icono: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1 rounded-full bg-white/15 py-1 pl-1.5 pr-2.5 text-sm">
      <Icon name={icono} className="!text-[18px]" />
      {children}
    </span>
  )
}

/**
 * El andén y la máquina, arriba del todo y en las dos armazones.
 *
 * El andén decide qué tareas le caen y qué camión retoma al entrar a Ingreso o a Despacho;
 * la máquina decide a qué altura del rack llegan esas tareas, porque el de piso no sube y
 * el de rack no baja. Antes la máquina sólo se veía en Disponibilidad, así que quien no
 * recibía nada en toda la mañana no tenía cómo saber si era que no había tareas o que no
 * le tocaban. Van juntas y se devuelve nulo cuando no hay ninguna de las dos.
 */
function Turno({ anden, equipo }: { anden: string | null; equipo: string | null }) {
  if (!anden && !equipo) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {anden ? <Pastilla icono="pin_drop">{nombrePosicion(anden)}</Pastilla> : null}
      {equipo ? <Pastilla icono="forklift">{equipo}</Pastilla> : null}
    </div>
  )
}

/**
 * Dos armazones, no uno estirado: el teléfono lleva la barra azul arriba y los cinco botones
 * abajo; la computadora, una lateral fija con todas las pantallas y el ancho entero para el
 * contenido.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const trabajo = { rol: user.workingRole, enMano: user.tareasEnMano }
  const { sueltos, grupos } = navAgrupado(user.roles, trabajo)
  const abajo = navMovil(user.roles, trabajo)

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <aside className="sticky top-0 hidden h-dvh w-61 shrink-0 flex-col bg-azul text-white md:flex">
        <div className="flex flex-col items-start gap-1.5 px-5 py-5">
          <Image src="/logo-dinant.png" alt="Dinant" width={112} height={32} priority />
          {user.anden || user.equipo ? (
            <Turno anden={user.anden} equipo={user.equipo} />
          ) : (
            <p className="text-sm text-white/60">WMS Palmerola</p>
          )}
        </div>

        <SideNav sueltos={sueltos} grupos={grupos} />

        <div className="flex items-center gap-2 border-t border-white/15 p-3">
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm">{user.fullName}</p>
            <p className="text-xs text-white/60">{ROLE_LABELS[user.role]}</p>
          </div>
          <form action={logout}>
            <button type="submit" aria-label="Cerrar sesión" className={BOTON_SALIR}>
              <Icon name="logout" />
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 bg-azul text-white md:hidden">
          <div className="flex w-full items-center gap-4 px-4 py-3">
            <Image src="/logo-dinant.png" alt="Dinant" width={96} height={27} priority />

            <div className="ml-auto flex items-center gap-3">
              <div className="hidden text-right leading-tight sm:block">
                <p className="truncate text-sm">{user.fullName}</p>
                <p className="text-xs text-white/60">{ROLE_LABELS[user.role]}</p>
              </div>
              <form action={logout}>
                <button type="submit" aria-label="Cerrar sesión" className={BOTON_SALIR}>
                  <Icon name="logout" />
                </button>
              </form>
            </div>
          </div>

          {/* En su propia línea: en un teléfono las dos pastillas no caben al lado del logo. */}
          {user.anden || user.equipo ? (
            <div className="px-4 pb-3">
              <Turno anden={user.anden} equipo={user.equipo} />
            </div>
          ) : null}
        </header>

        <div className="flex w-full flex-1 flex-col">{children}</div>

        <BottomNav items={abajo} />
      </div>
    </div>
  )
}
