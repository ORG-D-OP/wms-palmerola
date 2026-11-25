/**
 * La huella de un documento: un resumen corto de todas sus filas, para saber si el archivo
 * nuevo lo trae igual que la vez pasada sin tener que mandarlo a la base para averiguarlo.
 *
 * SAP no marca los complementos. Un transporte que a las ocho traía 20 líneas puede venir a
 * las once con 27 y nada en el archivo dice cuáles son las siete nuevas, así que un documento
 * se manda entero o no se manda. La huella es lo que decide cuál de las dos.
 *
 * Se calcula aquí, en la máquina de quien sube el archivo, porque mandar las filas a la base
 * para que las compare sería exactamente el tráfico que se quiere evitar.
 */

/**
 * Sube de uno cada vez que cambie **lo que el lector saca de una fila**: una columna nueva, un
 * campo que deja de leerse, un formato distinto. Las huellas viejas dejan de coincidir y todo
 * se vuelve a cargar una vez, que es justo lo que hace falta para que la base se ponga al día
 * con el lector nuevo.
 */
const VERSION = 1

/**
 * Dos acumuladores de 32 bits a la FNV-1a, juntos en un número de 53 bits. No es criptografía
 * y no hace falta que lo sea: aquí sólo se compara una huella contra la que dejó el mismo
 * documento la vez anterior. Con 53 bits, el día que la bodega lleve cuatrocientos documentos
 * subidos cada media hora durante un año, la probabilidad de que dos contenidos distintos den
 * la misma huella es de una en mil millones.
 *
 * El `subtle.digest` del navegador daría un SHA-256, pero es asíncrono y hay que recorrer
 * 25,873 filas: esto son dos multiplicaciones por carácter y no bloquea la pantalla.
 */
function resumir(texto: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/**
 * La huella de las filas de un documento. Se ordenan antes de resumir porque el mismo
 * documento puede venir con sus líneas en otro orden sin que haya cambiado nada; el lector
 * arma cada fila con el mismo objeto literal, así que sus campos salen siempre en el mismo
 * orden y el texto es comparable.
 */
export function huella(filas: unknown[]): string {
  const canonico = filas.map((f) => JSON.stringify(f)).sort()
  return `${VERSION}.${filas.length}.${resumir(canonico.join('\n'))}`
}
