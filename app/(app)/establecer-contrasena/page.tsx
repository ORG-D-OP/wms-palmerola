import { requireUser } from '@/lib/auth/session'
import { PasswordForm } from './password-form'

export const metadata = { title: 'Contrasena · WMS Palmerola' }

export default async function SetPasswordPage() {
  const user = await requireUser()

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-xl">Pon tu contrasena</h1>
        <p className="text-sm text-azul/60">{user.email}</p>
      </div>
      <PasswordForm />
    </main>
  )
}
