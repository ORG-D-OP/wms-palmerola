// Crea un usuario y devuelve un enlace para que la persona ponga su propia contrasena.
// El registro publico esta desactivado a proposito: las altas las hace un administrador.
//   node scripts/create-user.mjs correo@dinant.com "Nombre Apellido" supervisor
import { randomBytes } from 'node:crypto'
import { loadEnv } from './lib/env.mjs'

const [email, fullName, role = 'solo_lectura'] = process.argv.slice(2)

if (!email || !fullName) {
  console.error('Uso: node scripts/create-user.mjs <correo> "<nombre completo>" [rol]')
  process.exit(1)
}

const env = loadEnv(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY'])

const auth = async (path, body) => {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1${path}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.msg ?? json.message ?? JSON.stringify(json))
  return json
}

// Contrasena temporal que nadie llega a ver: la persona pone la suya con el enlace.
const user = await auth('/admin/users', {
  email,
  password: randomBytes(24).toString('base64url'),
  email_confirm: true,
  user_metadata: { full_name: fullName },
})

const rest = await fetch(
  `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/profile?id=eq.${user.id}`,
  {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ full_name: fullName, role }),
  },
)
const [profile] = await rest.json()

if (!profile) {
  console.error('El usuario se creo pero no se pudo asignar el perfil. Revisalo en el panel.')
  process.exit(1)
}

const link = await auth('/admin/generate_link', { type: 'recovery', email })

console.log(`\nUsuario creado: ${email}`)
console.log(`Rol: ${profile.role}`)
console.log(`\nEnvia este enlace para que ponga su contrasena (un solo uso):\n${link.action_link}\n`)
