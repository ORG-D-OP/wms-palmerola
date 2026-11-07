import { copyFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'

/**
 * zxing baja su `.wasm` de un CDN por defecto. Aqui se copia a `public/` para servirlo
 * desde nuestro propio dominio: la red de la empresa inspecciona el trafico y el anden no
 * es lugar para descubrir que un tercero no responde. Corre solo, antes de `dev` y `build`.
 */
const require = createRequire(import.meta.url)
const origen = require.resolve('zxing-wasm/reader/zxing_reader.wasm')
const destino = new URL('../public/zxing_reader.wasm', import.meta.url)

await mkdir(new URL('../public/', import.meta.url), { recursive: true })
await copyFile(origen, destino)
console.log('zxing_reader.wasm copiado a public/')
