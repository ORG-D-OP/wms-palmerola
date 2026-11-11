'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requirePermission } from '@/lib/auth/session'
import { ROLES } from '@/lib/auth/roles'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export type Resultado = { ok: true } | { ok: false; error: string }

const Persona = z.uuid()
const Rol = z.enum(ROLES as [string, ...string[]])

/** El mensaje de la base ya está escrito para quien lo va a leer; no hace falta traducirlo. */
function fallo(error: { message: string } | null): Resultado {
  return { ok: false, error: error?.message ?? 'No se pudo hacer el cambio.' }
}

async function llamar(fn: string, args: Record<string, unknown>): Promise<Resultado> {
  await requirePermission('personal:administrar')
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc(fn as never, args as never)
  if (error) return fallo(error)
  revalidatePath('/personal')
  return { ok: true }
}

export async function aceptar(id: string, rol: string): Promise<Resultado> {
  const persona = Persona.safeParse(id)
  const papel = Rol.safeParse(rol)
  if (!persona.success || !papel.success) return { ok: false, error: 'Elige un rol.' }
  return llamar('aprobar_persona', { p_id: persona.data, p_role: papel.data })
}

export async function rechazar(id: string): Promise<Resultado> {
  const persona = Persona.safeParse(id)
  if (!persona.success) return { ok: false, error: 'Persona inválida.' }
  return llamar('rechazar_registro', { p_id: persona.data })
}

export async function sacar(id: string): Promise<Resultado> {
  const persona = Persona.safeParse(id)
  if (!persona.success) return { ok: false, error: 'Persona inválida.' }
  return llamar('dar_de_baja', { p_id: persona.data })
}

export async function devolver(id: string): Promise<Resultado> {
  const persona = Persona.safeParse(id)
  if (!persona.success) return { ok: false, error: 'Persona inválida.' }
  return llamar('reactivar_persona', { p_id: persona.data })
}

export async function ponerRol(id: string, rol: string): Promise<Resultado> {
  const persona = Persona.safeParse(id)
  const papel = Rol.safeParse(rol)
  if (!persona.success || !papel.success) return { ok: false, error: 'Elige un rol.' }
  return llamar('cambiar_rol', { p_id: persona.data, p_role: papel.data })
}

export async function ponerCodigo(codigo: string): Promise<Resultado> {
  const parsed = z.string().trim().min(6, 'El código necesita al menos 6 caracteres.').max(40)
    .safeParse(codigo)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Código inválido.' }
  }
  return llamar('cambiar_codigo_registro', { p_codigo: parsed.data })
}
