// Da de alta a una persona y devuelve el enlace para que ponga su propia contrasena.
// Si ya existe, solo genera un enlace nuevo. El registro publico esta desactivado a
// proposito: las altas las hace un administrador.
//   node scripts/create-user.mjs correo@dinant.com "Nombre Apellido" supervisor
import { randomBytes } from 'node:crypto'
import { loadEnv } from './lib/env.mjs'

const [email, fullName, role = 'solo_lectura'] = process.argv.slice(2)

if (!email || !fullName) {
  console.error('Uso: node scripts/create-user.mjs <correo> "<nombre completo>" [rol]')
  process.exit(1)
}

const env = loadEnv(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY'])
const appUrl = env.APP_URL ?? 'http://localhost:3000'

const headers = {
  apikey: env.SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
  'Content-Type': 'application/json',
}

const call = async (path, method, body) => {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}${path}`, {
    method,
    headers: { ...headers, Prefer: 'return=representation' },
    body: body && JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, json }
}

// Contrasena temporal que nadie llega a ver: la persona pone la suya con el enlace.
const created = await call('/auth/v1/admin/users', 'POST', {
  email,
  password: randomBytes(24).toString('base64url'),
  email_confirm: true,
  user_metadata: { full_name: fullName },
})

if (!created.ok && created.status !== 422) {
  console.error(`No se pudo crear: ${created.json?.msg ?? created.status}`)
  process.exit(1)
}

const yaExistia = !created.ok
if (yaExistia) console.log(`${email} ya existe; se genera un enlace nuevo.`)

const link = await call('/auth/v1/admin/generate_link', 'POST', { type: 'recovery', email })
if (!link.ok || !link.json?.hashed_token) {
  console.error(`No se pudo generar el enlace: ${link.json?.msg ?? link.status}`)
  process.exit(1)
}

const profile = await call(
  `/rest/v1/profile?id=eq.${link.json.id}`,
  'PATCH',
  yaExistia ? { role } : { full_name: fullName, role },
)

if (!profile.ok || !profile.json?.[0]) {
  console.error('El usuario existe pero no se pudo asignar el rol. Revisalo en el panel.')
  process.exit(1)
}

const url = new URL('/auth/confirm', appUrl)
url.searchParams.set('token_hash', link.json.hashed_token)
url.searchParams.set('type', 'recovery')

console.log(`\n${email} — rol ${profile.json[0].role}`)
console.log(`\nEnlace de un solo uso para poner la contrasena:\n${url}\n`)
