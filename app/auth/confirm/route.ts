import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const TIPOS = ['recovery', 'invite', 'email'] as const
type Tipo = (typeof TIPOS)[number]

const esTipo = (value: string | null): value is Tipo =>
  value !== null && TIPOS.includes(value as Tipo)

/** Canjea el enlace de un solo uso por una sesion y manda a poner la contrasena. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  // Solo rutas internas: un `next` con dominio ajeno convierte esto en phishing.
  const next = searchParams.get('next') ?? '/establecer-contrasena'
  const destino = next.startsWith('/') && !next.startsWith('//') ? next : '/'

  if (!tokenHash || !esTipo(type)) {
    return NextResponse.redirect(`${origin}/login?error=enlace`)
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=enlace`)
  }

  return NextResponse.redirect(`${origin}${destino}`)
}
