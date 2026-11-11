import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { adminEnv, publicEnv } from '@/lib/env'
import type { Database } from '@/lib/database.types'

/**
 * Cliente con la llave secreta: salta RLS y puede crear cuentas.
 *
 * Existe por una sola razón: el registro ocurre cuando todavía no hay sesión, así que nadie
 * puede hablar con la base en su propio nombre. Fuera de ahí se usa el cliente de servidor
 * normal, que respeta las políticas.
 */
export function createSupabaseAdminClient() {
  return createClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    adminEnv().SUPABASE_SECRET_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}
