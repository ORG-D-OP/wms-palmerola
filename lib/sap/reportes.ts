import { fechaDeCelda, type Libro } from '../xlsx.ts'

/**
 * Los seis reportes de SAP que la bodega sube, y cómo se reconoce cada uno sin preguntarle
 * nada a la persona: por las columnas que trae. Nadie tiene que acertar un desplegable a las
 * seis de la mañana.
 */
export type Reporte = 'INGRESO' | 'DESPACHO' | 'INVENTARIO' | 'PRONOSTICO' | 'SALIDAS' | 'TRAZA'

export const NOMBRE: Record<Reporte, string> = {
  INGRESO: 'Traslados vía NEST — ingreso',
  DESPACHO: 'Datos de transporte — despacho',
  INVENTARIO: 'Existencia de SAP',
  PRONOSTICO: 'Pronóstico de venta',
  SALIDAS: 'Salidas de planta',
  TRAZA: 'Trazabilidad de cajas por pallet',
}

export type Donde = { kind: Reporte; hoja: string; cabecera: number }

const tieneTodas = (cabecera: string[], columnas: string[]) =>
  columnas.every((c) => cabecera.includes(c))

/**
 * Las dos columnas que delatan a cada reporte. Son las que no pueden faltar el día que la
 * descarga venga recortada a lo que el WMS ocupa: sin ellas el archivo no se reconoce y la
 * pantalla lo rechaza diciendo por qué. El ZMB51 sale dos veces porque SAP lo exporta con dos
 * juegos de rótulos para las mismas columnas.
 */
const SEÑAS: [Reporte, string[]][] = [
  ['DESPACHO', ['Número Transporte', 'UM venta']],
  ['INVENTARIO', ['Libre utilización', 'Texto breve de material']],
  ['SALIDAS', ['Clase de movimiento', 'Documento material']],
  ['SALIDAS', ['CMv', 'Doc.mat.']],
  ['INGRESO', ['Pallet', 'Salida Mercancia']],
  ['TRAZA', ['Pallet Actual', 'Correlativo Caja']],
  ['PRONOSTICO', ['Pronóstico', 'Cantidad cajas Pallet']],
]

/**
 * Qué reporte es. Se mira primero por el nombre de la hoja, que resuelve tres de los seis sin
 * descomprimir nada, y después por las cabeceras: **el nombre de la hoja es un atajo, no la
 * regla**, para que un libro guardado con otro nombre de hoja siga entrando.
 *
 * El ZMB51 cambió de formato entre noviembre y hoy —antes traía una fila de rótulos escritos a
 * mano encima de la cabecera de SAP—, así que se aceptan las dos y por eso se prueba también
 * la segunda fila.
 */
export async function reconocer(libro: Libro): Promise<Donde | null> {
  if (libro.hojas.includes('RawData')) return { kind: 'INGRESO', hoja: 'RawData', cabecera: 0 }
  if (libro.hojas.includes('Cajas por Pallet')) {
    return { kind: 'TRAZA', hoja: 'Cajas por Pallet', cabecera: 0 }
  }
  if (libro.hojas.includes('FCST')) return { kind: 'PRONOSTICO', hoja: 'FCST', cabecera: 0 }

  for (const hoja of libro.hojas) {
    const filas = await libro.filas(hoja)
    for (const cabecera of [0, 1]) {
      const h = filas[cabecera] ?? []
      for (const [kind, columnas] of SEÑAS) {
        if (tieneTodas(h, columnas)) return { kind, hoja, cabecera }
      }
    }
  }
  return null
}

/** Las filas de la hoja con su cabecera resuelta a índices, que es como se leen todas. */
export async function filasDe(libro: Libro, { hoja, cabecera }: Donde) {
  const todas = await libro.filas(hoja)
  const h = todas[cabecera] ?? []
  const indice = (nombre: string) => h.indexOf(nombre)
  const filas = todas.slice(cabecera + 1).filter((f) => f.some((v) => v !== ''))
  return { indice, filas }
}

export const limpio = (v: string | undefined) => (v ?? '').trim()
export const sinCeros = (v: string | undefined) => limpio(v).replace(/^0+/, '')
export const numero = (v: string | undefined) => {
  const n = Number(limpio(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}
export const fecha = (v: string | undefined) => fechaDeCelda(limpio(v))

/** Las filas de cada documento, juntas. Un documento se manda entero o no se manda. */
export function porDocumento<T>(filas: T[], clave: (f: T) => string): Map<string, T[]> {
  const grupos = new Map<string, T[]>()
  for (const f of filas) {
    const k = clave(f)
    const ya = grupos.get(k)
    if (ya) ya.push(f)
    else grupos.set(k, [f])
  }
  return grupos
}

/**
 * Parte las filas en tandas **sin cortar un documento por la mitad**. El número de línea se
 * calcula dentro de la tanda, así que si las líneas de un mismo camión llegaran en dos
 * envíos, la segunda tanda volvería a numerar desde uno y pisaría a la primera. Un camión
 * llega a 415 líneas, así que las tandas no salen descompensadas por respetarlo.
 */
export function tandas<T>(filas: T[], clave: (f: T) => string, tamano: number): T[][] {
  const grupos = porDocumento(filas, clave)

  const salida: T[][] = []
  let actual: T[] = []
  for (const grupo of grupos.values()) {
    if (actual.length > 0 && actual.length + grupo.length > tamano) {
      salida.push(actual)
      actual = []
    }
    actual.push(...grupo)
  }
  if (actual.length > 0) salida.push(actual)
  return salida
}

/**
 * La existencia es una foto con fecha, y la fecha no viene dentro del archivo: viene en su
 * nombre, `Inventario 14112026.xlsx`. Si no se puede leer de ahí, es la de hoy.
 */
export function fechaDelArchivo(nombre: string): string {
  const m = nombre.match(/(\d{2})(\d{2})(\d{4})/)
  if (!m) return new Date().toISOString().slice(0, 10)
  return `${m[3]}-${m[2]}-${m[1]}`
}
