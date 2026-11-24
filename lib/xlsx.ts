/**
 * Lector minimo de .xlsx, sin dependencias: un xlsx es un zip con XML dentro.
 *
 * Devuelve las celdas como texto tal cual las guardo Excel, que es justo lo que hace falta: el
 * codigo de material «20067.5» no debe pasar por un Number nunca.
 *
 * Corre igual en el servidor y en el navegador, y eso no es un lujo: **Vercel no deja pasar
 * un cuerpo de mas de 4.5 MB**, y los reportes que la bodega sube cada media hora pesan 4.3 MB
 * el de ingreso y 8.4 MB el de despacho. Asi que el Excel se abre donde esta —en la maquina de
 * quien lo sube— y al servidor viajan las filas ya entendidas, por tandas. Por eso descomprime
 * con `DecompressionStream`, que es asincrono, y por eso las hojas se leen una a una: el
 * reporte de ingreso trae quince y solo interesa una.
 */

const EOCD = 0x06054b50
const CEN = 0x02014b50

type Entrada = { metodo: number; comprimido: number; offset: number }

function leerU16(b: Uint8Array, p: number) {
  return b[p]! | (b[p + 1]! << 8)
}

function leerU32(b: Uint8Array, p: number) {
  return (b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16) | (b[p + 3]! << 24)) >>> 0
}

/** Indice de las entradas del zip: nombre -> donde empieza su cabecera local. */
function indice(buf: Uint8Array): Map<string, Entrada> {
  let fin = buf.length - 22
  while (fin >= 0 && leerU32(buf, fin) !== EOCD) fin--
  if (fin < 0) throw new Error('No parece un .xlsx: falta el fin del directorio del zip')

  const utf8 = new TextDecoder()
  const total = leerU16(buf, fin + 10)
  let p = leerU32(buf, fin + 16)
  const entradas = new Map<string, Entrada>()

  for (let i = 0; i < total; i++) {
    if (leerU32(buf, p) !== CEN) throw new Error('Directorio del zip corrupto')
    const nombreLen = leerU16(buf, p + 28)
    const extraLen = leerU16(buf, p + 30)
    const comentarioLen = leerU16(buf, p + 32)
    entradas.set(utf8.decode(buf.subarray(p + 46, p + 46 + nombreLen)), {
      metodo: leerU16(buf, p + 10),
      comprimido: leerU32(buf, p + 20),
      offset: leerU32(buf, p + 42),
    })
    p += 46 + nombreLen + extraLen + comentarioLen
  }
  return entradas
}

async function extraer(buf: Uint8Array, entrada: Entrada): Promise<string> {
  const p = entrada.offset
  const nombreLen = leerU16(buf, p + 26)
  const extraLen = leerU16(buf, p + 28)
  const inicio = p + 30 + nombreLen + extraLen
  const datos = buf.subarray(inicio, inicio + entrada.comprimido)
  if (entrada.metodo === 0) return new TextDecoder().decode(datos)

  const stream = new Blob([datos as BlobPart]).stream()
  return new Response(stream.pipeThrough(new DecompressionStream('deflate-raw'))).text()
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

const texto = (xml: string) =>
  xml.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (todo, e: string) => {
    if (e[0] === '#') {
      return String.fromCodePoint(Number(e[1] === 'x' ? `0x${e.slice(2)}` : e.slice(1)))
    }
    return ENTIDADES[e] ?? todo
  })

/** Todo el texto de un <si>, concatenando los <t> de las partes con formato. */
function cadenas(xml: string): string[] {
  const salida: string[] = []
  for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
    let s = ''
    for (const t of si.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? []) {
      s += texto(t.replace(/^<t[^>]*>/, '').replace(/<\/t>$/, ''))
    }
    salida.push(s)
  }
  return salida
}

const columna = (ref: string) => {
  let n = 0
  for (const c of ref.replace(/\d+/g, '')) n = n * 26 + (c.charCodeAt(0) - 64)
  return n - 1
}

function interpretar(xml: string, compartidas: string[]): string[][] {
  const filas: string[][] = []
  for (const fila of xml.match(/<row[^>]*>[\s\S]*?<\/row>|<row[^>]*\/>/g) ?? []) {
    const celdas: string[] = []
    // La celda vacia viene como `<c r="B7" s="1"/>`, sin cuerpo. Si no se contempla el cierre
    // corto, la celda siguiente se traga la vacia y la fila entera se corre un lugar desde
    // ahi: en el inventario de SAP eso le quitaba el codigo de material a 150 de 1,636 filas.
    for (const m of fila.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tipo = m[2]!.match(/t="([^"]*)"/)?.[1]
      const cuerpo = m[3] ?? ''
      let valor = ''
      if (tipo === 's') {
        valor = compartidas[Number(cuerpo.match(/<v>(\d+)<\/v>/)?.[1] ?? -1)] ?? ''
      } else if (tipo === 'inlineStr') {
        valor = (cuerpo.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [])
          .map((t) => texto(t.replace(/^<t[^>]*>/, '').replace(/<\/t>$/, '')))
          .join('')
      } else {
        valor = texto(cuerpo.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '')
      }
      celdas[columna(m[1]!)] = valor
    }
    // Las celdas vacias llegan como cadena vacia, no como undefined, para que el indice de
    // columna siempre cuadre con la cabecera.
    filas.push(Array.from(celdas, (c) => c ?? ''))
  }
  return filas
}

export type Libro = {
  /** Los nombres de las hojas, en el orden del libro. */
  hojas: string[]
  /** Las filas de una hoja. Sin nombre, la primera. */
  filas(hoja?: string): Promise<string[][]>
}

/** Abre el archivo y deja listo el indice; las hojas se descomprimen cuando se piden. */
export async function abrirLibro(bytes: Uint8Array): Promise<Libro> {
  const zip = indice(bytes)
  const parte = async (nombre: string) => {
    const entrada = zip.get(nombre)
    if (!entrada) throw new Error(`No se encontro ${nombre} dentro del archivo`)
    return extraer(bytes, entrada)
  }

  const libroXml = await parte('xl/workbook.xml')
  const declaradas = [...libroXml.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="rId(\d+)"/g)].map(
    (m) => ({ nombre: texto(m[1]!), rid: m[2]! }),
  )
  if (declaradas.length === 0) throw new Error('El archivo no declara hojas')

  const rels = await parte('xl/_rels/workbook.xml.rels')
  const compartidas = zip.has('xl/sharedStrings.xml')
    ? cadenas(await parte('xl/sharedStrings.xml'))
    : []

  const cache = new Map<string, string[][]>()

  return {
    hojas: declaradas.map((h) => h.nombre),
    async filas(hoja?: string) {
      const elegida = hoja ? declaradas.find((h) => h.nombre === hoja) : declaradas[0]
      if (!elegida) {
        throw new Error(`No hay hoja «${hoja}». Hay: ${declaradas.map((h) => h.nombre).join(', ')}`)
      }
      const ya = cache.get(elegida.nombre)
      if (ya) return ya
      const rel = rels.match(new RegExp(`Id="rId${elegida.rid}"[^>]*Target="([^"]*)"`))
      const ruta = `xl/${(rel?.[1] ?? `worksheets/sheet${elegida.rid}.xml`).replace(/^\/?xl\//, '')}`
      const leidas = interpretar(await parte(ruta), compartidas)
      cache.set(elegida.nombre, leidas)
      return leidas
    },
  }
}

/**
 * Excel guarda las fechas como dias desde el 30 de diciembre de 1899. Unos reportes las traen
 * ya formateadas («2026-11-01») y otros como ese numero, asi que hay que aguantar las dos.
 */
export function fechaDeCelda(valor: string): string | null {
  const v = valor.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  const n = Number(v)
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null
  return new Date(Date.UTC(1899, 11, 30) + Math.trunc(n) * 86_400_000).toISOString().slice(0, 10)
}
