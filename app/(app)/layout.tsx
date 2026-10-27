import Image from 'next/image'
import { requireUser } from '@/lib/auth/session'
import { ROLE_LABELS } from '@/lib/auth/roles'
import { navParaRol } from '@/components/app-shell/nav-items'
import { BottomNav } from '@/components/app-shell/bottom-nav'
import { TopNav } from '@/components/app-shell/top-nav'
import { Icon } from '@/components/ui/icon'
import { logout } from '@/app/(public)/login/actions'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const items = navParaRol(user.role)

  return (
    <>
      <header className="sticky top-0 z-10 bg-azul text-white">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-4 py-3">
          <Image src="/logo-dinant.png" alt="Dinant" width={96} height={22} priority />
          <TopNav items={items} />
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <p className="truncate text-sm">{user.fullName}</p>
              <p className="text-xs text-white/60">{ROLE_LABELS[user.role]}</p>
            </div>
            <form action={logout}>
              <button
                type="submit"
                aria-label="Salir"
                className="flex size-10 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/15 hover:text-white"
              >
                <Icon name="logout" />
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">{children}</div>

      <BottomNav items={items} />
    </>
  )
}
