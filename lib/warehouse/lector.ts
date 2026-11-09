import { FORMATOS_NATIVOS, FORMATOS_ZXING, esConfiable, normalizar } from './codigo'

export type Lectura = { texto: string; formato: string; confiable: boolean }
export type Lector = {
  /** Cual de los dos motores quedo. Se muestra en pantalla: si algo no lee, importa saberlo. */
  motor: string
  leer: (video: HTMLVideoElement) => Promise<Lectura[]>
}

type Crudo = (video: HTMLVideoElement) => Promise<{ texto: string; formato: string }[]>

type Detector = {
  detect(fuente: CanvasImageSource): Promise<{ rawValue: string; format: string }[]>
}
type ApiDetector = {
  new (opciones: { formats: string[] }): Detector
  getSupportedFormats(): Promise<string[]>
}

/** Mas ancho que esto zxing se arrastra y el telefono se calienta sin leer mejor. */
const ANCHO_MAXIMO = 1280

/**
 * Dos motores para el mismo trabajo.
 *
 * Chrome de Android trae `BarcodeDetector` y decodifica en el sistema operativo: rapido y
 * sin descargar nada. Donde no esta —Safari, sobre todo— se usa zxing, el mismo motor con
 * el que se leyeron los tabulados, que pesa casi un mega y por eso se baja solo cuando
 * alguien abre la camara. Quien escanea con laser no descarga ninguno de los dos.
 *
 * Cada motor saca los pixeles a su manera y por eso recibe el video entero: al nativo se le
 * pasa el elemento tal cual, que es el camino que Chrome tiene bien probado; copiarlo antes
 * a un `ImageData` le hacia devolver cero lecturas sin dar ningun error.
 *
 * Las lecturas salen todas, con su marca de confiable: una que no cuadra tambien dice algo,
 * y callarla deja al operario mirando una pantalla que no reacciona.
 */
export async function abrirLector(): Promise<Lector> {
  const nativo = await intentarNativo()
  const motor = nativo ? 'navegador' : 'zxing'
  const decodificar = nativo ?? (await cargarZxing())

  return {
    motor,
    leer: async (video) =>
      (await decodificar(video)).map((lectura) => {
        const texto = normalizar(lectura.texto)
        return { texto, formato: lectura.formato, confiable: esConfiable(texto, lectura.formato) }
      }),
  }
}

async function intentarNativo(): Promise<Crudo | null> {
  const api = (globalThis as { BarcodeDetector?: ApiDetector }).BarcodeDetector
  if (!api) return null

  // Hay navegadores que exponen la clase y no soportan ningun formato util, asi que no
  // basta con preguntar si existe.
  const soportados = await api.getSupportedFormats().catch(() => [] as string[])
  const formats = FORMATOS_NATIVOS.filter((formato) => soportados.includes(formato))
  if (formats.length === 0) return null

  const detector = new api({ formats })
  return async (video) =>
    (await detector.detect(video)).map((codigo) => ({
      texto: codigo.rawValue,
      formato: codigo.format,
    }))
}

async function cargarZxing(): Promise<Crudo> {
  const { readBarcodes, prepareZXingModule } = await import('zxing-wasm/reader')

  // El `.wasm` se sirve desde nuestro propio dominio. Por defecto zxing lo baja de un CDN,
  // y la red de la empresa inspecciona el trafico: una dependencia menos que pueda fallar
  // justo en el anden. Lo copia a `public/` el script `copiar-wasm`.
  prepareZXingModule({ overrides: { locateFile: (archivo: string) => `/${archivo}` } })

  const lienzo = document.createElement('canvas')
  const pincel = lienzo.getContext('2d', { willReadFrequently: true })

  return async (video) => {
    if (!pincel || !video.videoWidth) return []
    const escala = Math.min(1, ANCHO_MAXIMO / video.videoWidth)
    lienzo.width = Math.round(video.videoWidth * escala)
    lienzo.height = Math.round(video.videoHeight * escala)
    pincel.drawImage(video, 0, 0, lienzo.width, lienzo.height)

    return (
      await readBarcodes(pincel.getImageData(0, 0, lienzo.width, lienzo.height), {
        formats: [...FORMATOS_ZXING],
        tryHarder: true,
        tryRotate: true,
        tryDownscale: true,
        maxNumberOfSymbols: 1,
      })
    )
      .filter((resultado) => resultado.isValid)
      .map((resultado) => ({ texto: resultado.text, formato: resultado.format }))
  }
}
