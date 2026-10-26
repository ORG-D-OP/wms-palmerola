import { NextResponse, connection } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { toErrorResponse } from '@/lib/errors'

/** Comprueba que la aplicacion alcanza Supabase. No expone datos ni detalles del fallo. */
export async function GET() {
  // Fuera del try: su senal de aborto en prerender es control de flujo de Next, no un error.
  await connection()

  try {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.getUser()

    // Sin sesion la respuesta es un error esperado de autenticacion, no un fallo de red.
    const reachable = !error || error.status !== undefined

    return NextResponse.json({ ok: true, supabase: reachable ? 'ok' : 'sin respuesta' })
  } catch (error) {
    const { body, status } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
