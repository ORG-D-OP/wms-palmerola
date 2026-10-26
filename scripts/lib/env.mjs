import { existsSync, readFileSync } from 'node:fs'

/** Lee .env.local y corta con un mensaje util si falta el archivo o alguna variable. */
export function loadEnv(required = []) {
  if (!existsSync('.env.local')) {
    console.error(
      `No se encontro .env.local en ${process.cwd()}\n` +
        'Corre este comando desde la carpeta del proyecto.',
    )
    process.exit(1)
  }

  const env = {}
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
  }

  const missing = required.filter((key) => !env[key])
  if (missing.length > 0) {
    console.error(`Falta en .env.local: ${missing.join(', ')}`)
    process.exit(1)
  }

  return env
}
