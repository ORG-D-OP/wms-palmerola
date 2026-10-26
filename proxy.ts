import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { serverEnv } from '@/lib/env'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export default async function proxy(request: NextRequest) {
  const env = serverEnv()

  // SameSite=Lax no cubre todos los casos de CSRF en peticiones no-GET: se valida el origen.
  if (MUTATING_METHODS.has(request.method)) {
    const origin = request.headers.get('origin')
    if (!origin || !env.ALLOWED_ORIGINS.includes(origin)) {
      return NextResponse.json({ error: 'Origen no permitido.' }, { status: 403 })
    }
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  // Refresca el token. getUser valida contra el servidor de Supabase; getSession no.
  await supabase.auth.getUser()

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
