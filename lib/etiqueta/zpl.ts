import { fecha } from '@/lib/fechas'
import { fechaYHora } from '@/lib/warehouse/hora'

/**
 * La etiqueta de pallet del WMS, en ZPL.
 *
 * Sigue el molde de la etiqueta de planta, que es la que la gente de la bodega ya sabe leer:
 * un dato enorme arriba, la cantidad debajo, el producto en medio y el código de barras al pie.
 * Lo que cambia es qué va en cada hueco. Arriba, donde la de planta pone el país, aquí va el
 * **vencimiento**, porque es lo que decide todo en esta bodega: el reparto es FEFO al día
 * exacto. Y lo que la de planta usa para su propia trazabilidad —máquina, turno, su
 * correlativo— aquí no significa nada y se cambió por de dónde vino el pallet.
 *
 * El código de barras lleva la matrícula del WMS tal cual (`WMS-00000123`), que es la misma
 * que `matricula_wms_seq` le puso al recibirlo: escanearla en guardar, reordenar o contar
 * encuentra el pallet sin que nadie teclee nada.
 */

export type Etiqueta = {
  matricula: string
  sku: string
  producto: string
  cajas: number
  lote: string | null
  vence: string | null
  /** De dónde salió el pallet: el pedido, el andén, quién lo armó. */
  origen: string
  cuando: Date
}

/**
 * `^` y `~` abren orden en ZPL y `\` escapa dentro de un campo: un nombre de producto que los
 * traiga partiría la etiqueta en dos. Se quitan en vez de escaparlos porque en un nombre de
 * producto no dicen nada, y el recorte evita que un nombre largo empuje al resto fuera del papel.
 */
const limpio = (texto: string, largo: number) =>
  texto
    .replace(/[\^~\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, largo)

/** El margen del papel, en puntos. A 8 puntos/mm son poco más de 3 mm. */
const MARGEN = 25

/**
 * El rollo que la bodega tiene puesto, leído de la propia impresora el 28/11/2026:
 * `832 PRINT WIDTH` x `1224 LABEL LENGTH` a 8 puntos/mm, o sea 104 x 153 mm.
 *
 * Esto es medida del papel, no parámetro del almacén: el diseño de abajo está dibujado encima
 * de este lienzo y con otro rollo no se arregla cambiando el número, hay que volver a dibujar.
 */
export const PAPEL = { ancho: 832, largo: 1224 } as const

export function etiquetaDePallet(datos: Etiqueta): string {
  const ancho = PAPEL.ancho
  const util = ancho - MARGEN * 2
  const matricula = limpio(datos.matricula, 32)

  return [
    '^XA',
    // UTF-8: sin esto las tildes y la eñe de los nombres de producto salen como basura.
    '^CI28',
    `^PW${ancho}`,
    `^LL${PAPEL.largo}`,
    '^LH0,0',
    `^FO${MARGEN},${MARGEN}^GB${util},1174,3^FS`,

    `^FO50,50^A0N,34,34^FDVENCE^FS`,
    `^FO50,88^A0N,120,120^FD${datos.vence ? fecha(datos.vence) : 'SIN FECHA'}^FS`,
    `^FO${MARGEN},220^GB${util},3,3^FS`,

    `^FO50,245^A0N,185,185^FD${datos.cajas}^FS`,
    `^FO50,435^A0N,42,42^FD${datos.cajas === 1 ? 'caja' : 'cajas'}^FS`,
    `^FO400,250^A0N,34,34^FDLOTE^FS`,
    `^FO400,288^A0N,70,70^FD${datos.lote ? limpio(datos.lote, 18) : '—'}^FS`,
    `^FO${MARGEN},500^GB${util},3,3^FS`,

    `^FO50,520^A0N,34,34^FDPRODUCTO^FS`,
    `^FO50,560^A0N,48,48^FD${limpio(datos.sku, 24)}^FS`,
    `^FO50,618^A0N,44,44^FB${util - 50},3,6,L^FD${limpio(datos.producto, 90)}^FS`,
    `^FO${MARGEN},780^GB${util},3,3^FS`,

    `^FO50,800^A0N,32,32^FD${limpio(datos.origen, 60)} | ${fechaYHora(datos.cuando)}^FS`,

    `^FO50,855^A0N,34,34^FDMATRICULA DE PALLET^FS`,
    // El texto del código va aparte y más grande que el que dibuja `^BC`, para que se pueda
    // teclear a mano el día que el lector no lea.
    `^FO60,900^BY4,3,120^BCN,120,N,N,N^FD${matricula}^FS`,
    `^FO50,1035^A0N,78,78^FD${matricula}^FS`,
    '^XZ',
  ].join('\n')
}
