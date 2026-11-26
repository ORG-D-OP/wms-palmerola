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

/**
 * El andén, arriba del todo y en las dos armazones.
 *
 * No es un adorno: es lo que decide qué tareas le caen y qué camión retoma al entrar a
 * Ingreso o a Despacho. Quien se cambia de andén tiene que verlo cambiar.
 */
function Anden({ anden }: { anden: string | null }) {
  if (!anden) return null
  return (
    <span className="flex items-center gap-1 rounded-full bg-white/15 py-1 pl-1.5 pr-2.5 text-sm">
      <Icon name="pin_drop" className="!text-[18px]" />
      {nombrePosicion(anden)}
    </span>
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
          {user.anden ? (
            <Anden anden={user.anden} />
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
            <Anden anden={user.anden} />

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
        </header>

        <div className="flex w-full flex-1 flex-col">{children}</div>

        <BottomNav items={abajo} />
      </div>
    </div>
  )
}
