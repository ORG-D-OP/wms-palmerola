// Corre todas las pruebas de la base, varias a la vez.
//
//   node scripts/probar.mjs            todas
//   node scripts/probar.mjs picking    solo las que lleven «picking» en el nombre
//
// Cada script levanta su propio Postgres en memoria y le aplica las migraciones desde cero:
// son procesos independientes que no comparten nada, no escriben en disco y no salen a la red,
// asi que no hay ninguna razon para correrlos en fila. Medido el 25/11/2026, el CI tardaba 431
// segundos y 340 eran estos scripts, uno detras de otro.
//
// Los scripts se descubren solos. Uno nuevo entra con solo llamarse `check-algo.mjs`, sin
// tener que acordarse de encadenarlo en el package.json.
import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { availableParallelism } from 'node:os'

// `check-migrations` no va aqui: ese es `db:check` y corre antes, porque si una migracion no
// aplica no tiene sentido mirar nada mas.
const APARTE = ['check-migrations.mjs']

const filtro = process.argv.slice(2)
const scripts = readdirSync('scripts')
  .filter((f) => f.startsWith('check-') && f.endsWith('.mjs') && !APARTE.includes(f))
  .filter((f) => filtro.length === 0 || filtro.some((q) => f.includes(q)))
  .sort()

if (scripts.length === 0) {
  console.error(filtro.length ? `Ningun check coincide con «${filtro.join(' ')}»` : 'No hay checks')
  process.exit(1)
}

// Cada uno se lleva un nucleo entero mientras aplica las migraciones. Mas procesos que nucleos
// solo los hace pelearse; el tope de ocho es para que una maquina grande no abra veintitres
// Postgres a la vez y se quede sin memoria.
const ALA_VEZ = Math.max(1, Math.min(availableParallelism(), 8))

const correr = (script) =>
  new Promise((listo) => {
    const t0 = Date.now()
    const hijo = spawn(process.execPath, [`scripts/${script}`], { stdio: ['ignore', 'pipe', 'pipe'] })
    let salida = ''
    hijo.stdout.on('data', (d) => (salida += d))
    hijo.stderr.on('data', (d) => (salida += d))
    hijo.on('close', (codigo) => {
      // El aviso de Node sobre los .ts sin "type": "module" sale en cada proceso y no dice nada.
      const lineas = salida
        .split('\n')
        .filter((l) => l.trim() && !/MODULE_TYPELESS_PACKAGE_JSON|Reparsing as ES module|To eliminate this warning|trace-warnings/.test(l))
      listo({
        script,
        codigo,
        ms: Date.now() - t0,
        lineas,
        oks: lineas.filter((l) => l.startsWith('ok')).length,
        fallas: lineas.filter((l) => l.startsWith('falla')).length,
      })
    })
  })

const t0 = Date.now()
const pendientes = [...scripts]
const hechos = []

await Promise.all(
  Array.from({ length: Math.min(ALA_VEZ, pendientes.length) }, async () => {
    for (let script = pendientes.shift(); script; script = pendientes.shift()) {
      const r = await correr(script)
      hechos.push(r)
      // La salida de cada uno se imprime junta cuando termina: intercalada seria ilegible.
      console.log(`\n--- ${r.script}  (${(r.ms / 1000).toFixed(1)} s)`)
      for (const l of r.lineas) console.log(l)
    }
  }),
)

const oks = hechos.reduce((n, r) => n + r.oks, 0)
const fallas = hechos.reduce((n, r) => n + r.fallas, 0)
const rotos = hechos.filter((r) => r.codigo !== 0)
const segundos = ((Date.now() - t0) / 1000).toFixed(1)

console.log(
  `\n${oks} comprobaciones en ${scripts.length} scripts, de ${ALA_VEZ} en ${ALA_VEZ}: ${segundos} s`,
)

if (fallas || rotos.length) {
  if (fallas) console.error(`${fallas} fallaron`)
  for (const r of rotos.filter((r) => r.fallas === 0)) {
    console.error(`${r.script} se murió sin terminar (código ${r.codigo})`)
  }
  process.exit(1)
}
