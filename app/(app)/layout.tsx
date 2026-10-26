import { requireUser } from '@/lib/auth/session'
import { ROLE_LABELS } from '@/lib/auth/roles'
import { logout } from '@/app/(public)/login/actions'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()

  return (
    <>
      <header className="flex items-center justify-between gap-4 border-b border-black/10 px-4 py-3 dark:border-white/15">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{user.fullName}</p>
          <p className="text-xs opacity-60">{ROLE_LABELS[user.role]}</p>
        </div>
        <form action={logout}>
          <button type="submit" className="text-sm underline underline-offset-4">
            Salir
          </button>
        </form>
      </header>
      {children}
    </>
  )
}
