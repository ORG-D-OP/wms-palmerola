/**
 * Que acepta el WMS como lectura valida.
 *
 * El lector laser entrega texto ya verificado por su propio hardware. La camara no verifica
 * nada: entrega lo que creyo ver. Para que las dos formas de escanear valgan lo mismo, el
 * filtro vive aqui y corre para las dos.
 */

/** Nombres de `BarcodeDetector`, la API nativa del navegador. */
export const FORMATOS_NATIVOS = [
  'code_128',
  'itf',
  'qr_code',
  'ean_13',
  'ean_8',
  'upc_a',
  'data_matrix',
] as const

/** Los mismos formatos como los nombra zxing, que es el respaldo. */
export const FORMATOS_ZXING = [
  'Code128',
  'ITF',
  'QRCode',
  'EAN-13',
  'EAN-8',
  'UPC-A',
  'DataMatrix',
] as const

/** Largos que llevan digito verificador GS1: EAN-8, UPC-A, EAN-13 y el DUN-14. */
const LARGOS_GS1 = new Set([8, 12, 13, 14])

/** Modulo 10 de GS1: pesos 3 y 1 alternados desde el digito de mas a la derecha. */
export function digitoGs1(datos: string): number {
  let suma = 0
  let peso = 3
  for (let i = datos.length - 1; i >= 0; i--) {
    suma += Number(datos[i]) * peso
    peso = peso === 3 ? 1 : 3
  }
  return (10 - (suma % 10)) % 10
}

export function cumpleGs1(codigo: string): boolean {
  if (!LARGOS_GS1.has(codigo.length) || !/^\d+$/.test(codigo)) return false
  return digitoGs1(codigo.slice(0, -1)) === Number(codigo.slice(-1))
}

/** Los lectores meten identificadores de simbologia y saltos de linea; aqui se van. */
export function normalizar(texto: string): string {
  return texto.replace(/[\u0000-\u001f\u007f]/g, '').trim()
}

/**
 * El ITF se lee de a pares de digitos y no tiene delimitador propio, asi que una camara
 * puede devolver un pedazo del codigo como si fuera el codigo entero. Un DUN-14 leido a
 * medias no da error: da otro numero, valido, que apunta a otro producto. Por eso al ITF
 * se le exige largo de GS1 y digito verificador. Los demas formatos ya traen su control:
 * el Code 128 lleva suma de verificacion obligatoria y el QR, correccion de errores.
 */
export function esConfiable(texto: string, formato: string): boolean {
  if (!texto) return false
  if (formato.toLowerCase().startsWith('itf')) return cumpleGs1(texto)
  return true
}
