import Image from 'next/image'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/session'
import { Aviso } from '@/components/ui/feedback'
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
    <main className="flex flex-1 flex-col bg-azul md:flex-row">
      <section className="flex shrink-0 flex-col justify-center gap-4 p-8 md:flex-1">
        <Image src="/logo-dinant.png" alt="Dinant" width={160} height={37} priority />
        <h1 className="text-3xl text-white">WMS Palmerola</h1>
        <p className="max-w-sm text-white/70">
          Sistema de gestión de almacén. Creamos mejores días, siempre.
        </p>
      </section>

      <section className="flex flex-1 flex-col justify-center gap-6 rounded-t-3xl bg-white p-8 md:w-[26rem] md:flex-none md:rounded-none">
        <h2 className="text-xl">Entrar</h2>
        {error === 'enlace' ? (
          <Aviso>El enlace ya se usó o venció. Pide uno nuevo a tu administrador.</Aviso>
        ) : null}
        <LoginForm />
      </section>
    </main>
  )
}
