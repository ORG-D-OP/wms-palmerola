import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/session'
import { LoginForm } from './login-form'

export const metadata = { title: 'Entrar · WMS Palmerola' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  if (await getSessionUser()) redirect('/')

  const { error } = await searchParams

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">WMS Palmerola</h1>
        <p className="text-sm opacity-70">Sistema de gestion de almacen</p>
      </div>

      {error === 'enlace' ? (
        <p role="alert" className="max-w-sm text-center text-sm text-red-600 dark:text-red-400">
          El enlace ya se uso o vencio. Pide uno nuevo a tu administrador.
        </p>
      ) : null}

      <LoginForm />
    </main>
  )
}
