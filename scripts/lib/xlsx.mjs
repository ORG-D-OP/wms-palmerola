// Lector minimo de .xlsx, sin dependencias: un xlsx es un zip con XML dentro.
// Devuelve las celdas como texto tal cual las guardo Excel, que es justo lo que hace
// falta: el codigo de material «20067.5» no debe pasar por un Number nunca.
import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

const EOCD = 0x06054b50
const CEN = 0x02014b50

/** Indice de las entradas del zip: nombre -> donde empieza su cabecera local. */
function indice(buf) {
  let fin = buf.length - 22
  while (fin >= 0 && buf.readUInt32LE(fin) !== EOCD) fin--
  if (fin < 0) throw new Error('No parece un .xlsx: falta el fin del directorio del zip')

  const total = buf.readUInt16LE(fin + 10)
  let p = buf.readUInt32LE(fin + 16)
  const entradas = new Map()

  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== CEN) throw new Error('Directorio del zip corrupto')
    const nombreLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const comentarioLen = buf.readUInt16LE(p + 32)
    entradas.set(buf.toString('utf8', p + 46, p + 46 + nombreLen), {
      metodo: buf.readUInt16LE(p + 10),
      comprimido: buf.readUInt32LE(p + 20),
      offset: buf.readUInt32LE(p + 42),
    })
    p += 46 + nombreLen + extraLen + comentarioLen
  }
  return entradas
}

function extraer(buf, entrada) {
  const p = entrada.offset
  const nombreLen = buf.readUInt16LE(p + 26)
  const extraLen = buf.readUInt16LE(p + 28)
  const datos = buf.subarray(p + 30 + nombreLen + extraLen, p + 30 + nombreLen + extraLen + entrada.comprimido)
  return (entrada.metodo === 0 ? datos : inflateRawSync(datos)).toString('utf8')
}

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

const texto = (xml) =>
  xml.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (todo, e) => {
    if (e[0] === '#') return String.fromCodePoint(Number(e[1] === 'x' ? `0x${e.slice(2)}` : e.slice(1)))
    return ENTIDADES[e] ?? todo
  })

/** Todo el texto de un <si>, concatenando los <t> de las partes con formato. */
function cadenas(xml) {
  const salida = []
  for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
    let s = ''
    for (const t of si.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? []) {
      s += texto(t.replace(/^<t[^>]*>/, '').replace(/<\/t>$/, ''))
    }
    salida.push(s)
  }
  return salida
}

const columna = (ref) => {
  let n = 0
  for (const c of ref.replace(/\d+/g, '')) n = n * 26 + (c.charCodeAt(0) - 64)
  return n - 1
}

/**
 * Lee una hoja y devuelve filas de texto. `hoja` es el nombre; sin nombre toma la primera.
 * Las celdas vacias llegan como cadena vacia, no como undefined, para que el indice de
 * columna siempre cuadre con la cabecera.
 */
export function readXlsx(archivo, hoja) {
  const buf = readFileSync(archivo)
  const zip = indice(buf)

  const libro = extraer(buf, zip.get('xl/workbook.xml'))
  const hojas = [...libro.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="rId(\d+)"/g)].map((m) => ({
    nombre: texto(m[1]),
    rid: m[2],
  }))
  if (hojas.length === 0) throw new Error('El archivo no declara hojas')

  const elegida = hoja ? hojas.find((h) => h.nombre === hoja) : hojas[0]
  if (!elegida) {
    throw new Error(`No hay hoja «${hoja}». Hay: ${hojas.map((h) => h.nombre).join(', ')}`)
  }

  const rels = extraer(buf, zip.get('xl/_rels/workbook.xml.rels'))
  const rel = rels.match(new RegExp(`Id="rId${elegida.rid}"[^>]*Target="([^"]*)"`))
  const ruta = `xl/${(rel?.[1] ?? `worksheets/sheet${elegida.rid}.xml`).replace(/^\/?xl\//, '')}`
  const entrada = zip.get(ruta)
  if (!entrada) throw new Error(`No se encontro ${ruta} dentro del archivo`)

  const compartidas = zip.has('xl/sharedStrings.xml')
    ? cadenas(extraer(buf, zip.get('xl/sharedStrings.xml')))
    : []

  const filas = []
  for (const fila of extraer(buf, entrada).match(/<row[^>]*>[\s\S]*?<\/row>|<row[^>]*\/>/g) ?? []) {
    const celdas = []
    for (const m of fila.matchAll(/<c r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const tipo = m[2].match(/t="([^"]*)"/)?.[1]
      const cuerpo = m[3]
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
      celdas[columna(m[1])] = valor
    }
    filas.push(Array.from(celdas, (c) => c ?? ''))
  }
  return filas
}
