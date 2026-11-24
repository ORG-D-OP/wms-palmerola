// El lector de Excel vive en `lib/xlsx.ts` porque lo usan la aplicacion y los scripts. Aqui
// solo esta lo que es de consola: leer el archivo del disco.
import { readFileSync } from 'node:fs'
import { abrirLibro } from '../../lib/xlsx.ts'

export const abrirArchivo = (ruta) => abrirLibro(new Uint8Array(readFileSync(ruta)))
