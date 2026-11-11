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

/**
 * El jefe llega con la lista entera, así que acepta lo que sea: un correo por línea, comas o
 * punto y coma. Partirlo aquí le ahorra veinte envíos del formulario.
 */
export async function autorizarCorreos(texto: string, nota: string): Promise<Resultado> {
  const correos = [...new Set(
    texto.split(/[\s,;]+/).map((c) => c.trim().toLowerCase()).filter(Boolean),
  )]

  const malos = correos.filter((c) => !z.email().safeParse(c).success)
  if (malos.length > 0) {
    return { ok: false, error: `Esto no parece un correo: ${malos.slice(0, 3).join(', ')}` }
  }
  if (correos.length === 0) {
    return { ok: false, error: 'Escribe al menos un correo.' }
  }

  return llamar('autorizar_correos', {
    p_emails: correos,
    p_nota: nota.trim() || null,
  })
}

export async function quitarCorreo(email: string): Promise<Resultado> {
  const parsed = z.email().safeParse(email.trim().toLowerCase())
  if (!parsed.success) return { ok: false, error: 'Correo inválido.' }
  return llamar('quitar_correo', { p_email: parsed.data })
}
