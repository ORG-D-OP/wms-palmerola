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

/** Todos los DUN-14 del maestro tienen catorce digitos; ninguno tiene otro largo. */
const LARGO_DUN = 14

/**
 * Lo que cada campo acepta de la camara.
 *
 * Un campo que espera un pedido no deberia tragarse el QR del tabulado, que esta impreso
 * en la misma hoja y es un numero distinto. El laser y el teclado no pasan por aqui: el
 * laser no se equivoca de simbologia y teclear es deliberado. Esto es solo para la camara,
 * que lee lo que encuentre delante.
 *
 * Se nombran, no se pasan como expresion regular, porque el boton viaja del servidor al
 * navegador y una expresion regular no cruza esa frontera.
 */
export const FORMATOS_DE_CAMPO = {
  /** El Pedido del comprobante de carga: ocho digitos, como 60213772. */
  pedido: { patron: /^\d{8}$/, nombre: 'un pedido de ocho dígitos' },
  /** El transporte del tabulado: siete digitos, como 3916464. */
  transporte: { patron: /^\d{6,8}$/, nombre: 'un número de transporte' },
} as const

export type FormatoDeCampo = keyof typeof FORMATOS_DE_CAMPO

export function cumpleFormato(texto: string, formato: FormatoDeCampo | undefined): boolean {
  if (!formato) return true
  return FORMATOS_DE_CAMPO[formato].patron.test(texto)
}

/**
 * El ITF se lee de a pares de digitos y no tiene delimitador propio, asi que una camara
 * puede devolver un pedazo del codigo como si fuera el codigo entero. Un DUN-14 leido a
 * medias no da error: da otro numero, valido, que apunta a otro producto.
 *
 * Lo que atrapa ese caso es el largo, no el verificador: un ITF leido a medias siempre
 * sale mas corto. Y exigir verificador de mas dejaria siete productos del maestro sin
 * poder escanearse, porque su DUN-14 viene de SAP con el digito mal. Asi que un ITF pasa
 * si trae los catorce digitos, o si cuadra el verificador con otro largo de GS1.
 *
 * Los demas formatos ya traen su propio control: el Code 128 lleva suma de verificacion
 * obligatoria y el QR, correccion de errores.
 */
export function esConfiable(texto: string, formato: string): boolean {
  if (!texto) return false
  if (!formato.toLowerCase().startsWith('itf')) return true
  if (/^\d+$/.test(texto) && texto.length === LARGO_DUN) return true
  return cumpleGs1(texto)
}
