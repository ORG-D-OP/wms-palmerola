import { FORMATOS_NATIVOS, FORMATOS_ZXING, esConfiable, normalizar } from './codigo'

export type Lectura = { texto: string; formato: string }
export type Decodificador = (imagen: ImageData) => Promise<Lectura[]>

type Detector = { detect(imagen: ImageData): Promise<{ rawValue: string; format: string }[]> }
type ApiDetector = {
  new (opciones: { formats: string[] }): Detector
  getSupportedFormats(): Promise<string[]>
}

/**
 * Dos motores para el mismo trabajo.
 *
 * Chrome de Android trae `BarcodeDetector` y decodifica en el sistema operativo: rapido y
 * sin descargar nada. Donde no esta —Safari, sobre todo— se usa zxing, el mismo motor con
 * el que se leyeron los tabulados, que pesa casi un mega y por eso se baja solo cuando
 * alguien abre la camara. Quien escanea con laser no descarga ninguno de los dos.
 */
export async function abrirDecodificador(): Promise<Decodificador> {
  const decodificar = (await nativo()) ?? (await respaldo())
  return async (imagen) =>
    (await decodificar(imagen))
      .map((lectura) => ({ ...lectura, texto: normalizar(lectura.texto) }))
      .filter((lectura) => esConfiable(lectura.texto, lectura.formato))
}

async function nativo(): Promise<Decodificador | null> {
  const api = (globalThis as { BarcodeDetector?: ApiDetector }).BarcodeDetector
  if (!api) return null

  // Hay navegadores que exponen la clase y no soportan ningun formato util, asi que no
  // basta con preguntar si existe.
  const soportados = await api.getSupportedFormats().catch(() => [] as string[])
  const formats = FORMATOS_NATIVOS.filter((formato) => soportados.includes(formato))
  if (formats.length === 0) return null

  const detector = new api({ formats })
  return async (imagen) =>
    (await detector.detect(imagen)).map((codigo) => ({
      texto: codigo.rawValue,
      formato: codigo.format,
    }))
}

async function respaldo(): Promise<Decodificador> {
  const { readBarcodes, prepareZXingModule } = await import('zxing-wasm/reader')

  // El `.wasm` se sirve desde nuestro propio dominio. Por defecto zxing lo baja de un CDN,
  // y la red de la empresa inspecciona el trafico: una dependencia menos que pueda fallar
  // justo en el anden. Lo copia a `public/` el script `copiar-wasm`.
  prepareZXingModule({ overrides: { locateFile: (archivo: string) => `/${archivo}` } })

  return async (imagen) =>
    (
      await readBarcodes(imagen, {
        formats: [...FORMATOS_ZXING],
        tryHarder: true,
        maxNumberOfSymbols: 1,
      })
    )
      .filter((resultado) => resultado.isValid)
      .map((resultado) => ({ texto: resultado.text, formato: resultado.format }))
}
