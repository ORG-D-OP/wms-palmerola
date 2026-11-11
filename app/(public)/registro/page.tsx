import Image from 'next/image'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/session'
import { RegistroForm } from './registro-form'

export const metadata = { title: 'Crear cuenta · WMS Palmerola' }

export default async function RegistroPage() {
  if (await getSessionUser()) redirect('/')

  return (
    <main className="flex flex-1 flex-col bg-azul md:flex-row">
      <section className="flex shrink-0 flex-col justify-center gap-4 p-8 md:flex-1">
        <Image src="/logo-dinant.png" alt="Dinant" width={160} height={37} priority />
        <h1 className="text-3xl text-white">Crear cuenta</h1>
        <p className="max-w-sm text-white/70">
          Para trabajar en la bodega. Cuando termines, el jefe de bodega tiene que aceptarte.
        </p>
      </section>

      <section className="flex flex-1 flex-col justify-center gap-6 rounded-t-3xl bg-white p-8 md:w-[26rem] md:flex-none md:rounded-none">
        <RegistroForm />
      </section>
    </main>
  )
}
