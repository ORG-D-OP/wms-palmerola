import type { Libro } from '../xlsx.ts'
import {
  fecha,
  filasDe,
  limpio,
  numero,
  reconocer,
  sinCeros,
  type Donde,
  type Reporte,
} from './reportes.ts'

export type FilaIngreso = {
  pedido: string
  pallet: string
  material: string
  cajas: number
  lote: string
  vencimiento: string | null
  planta: string
  fecha: string | null
  entrega: string
  salida: string
  mix: string
  centro: string
  a_ciegas: boolean
}

export type FilaDespacho = {
  transporte: string
  entrega: string
  posicion: number
  material: string
  cantidad: number
  um: string
  cliente: string
}

export type FilaInventario = {
  centro: string
  almacen: string
  material: string
  nombre: string
  uom: string
  libre: number
  pendiente: number
  bloqueado: number
  transito: number
}

export type FilaPronostico = {
  zona: string
  material: string
  nombre: string
  anio: number
  periodo: number
  cajas: number
  pallets: number
  cajas_por_pallet: number
}

export type FilaSalida = {
  pedido: string
  documento: string
  material: string
  cantidad: number
  centro: string
  centro_receptor: string
  clase: string
  fecha: string | null
}

export type Leido = {
  kind: Reporte
  leidas: number
  avisos: string[]
  ingresos?: FilaIngreso[]
  despachos?: FilaDespacho[]
  inventario?: FilaInventario[]
  pronostico?: FilaPronostico[]
  salidas?: FilaSalida[]
  resumen?: Record<string, number>
}

/**
 * El ZRDN trae quince hojas y los datos están en `RawData`. Se lee **por nombre de columna**,
 * no por posición: el día que la descarga venga recortada a lo que el WMS ocupa, las columnas
 * se corren y leerlas por número devolvería basura sin avisar.
 *
 * Los de 3010, 3014 y 5006 **no traen `Pedido Traslado`** —0 de 3,162 filas, medido—, así que
 * para esos la llave es la entrega y quedan marcados: esos camiones se reciben a ciegas
 * mientras no se sepa qué número viene impreso en su papel.
 */
async function ingresos(libro: Libro, donde: Donde): Promise<Leido> {
  const { indice, filas } = await filasDe(libro, donde)
  const C = {
    planta: indice('Planta'),
    pallet: indice('Pallet'),
    vencimiento: indice('Vencimiento'),
    lote: indice('Lote'),
    cantidad: indice('Cantidad'),
    material: indice('Material'),
    fecha: indice('Fecha'),
    nombreDestino: indice('Nest Nombre Destino'),
    centroDestino: indice('Nest Centro Destino'),
    pedido: indice('Pedido Traslado'),
    entrega: indice('Entrega'),
    salida: indice('Salida Mercancia'),
    documento: indice('Documento'),
  }

  const avisos: string[] = []
  let sinPedido = 0
  let sinLlave = 0

  const salida = filas
    .map((f): FilaIngreso => {
      const pedido = sinCeros(f[C.pedido])
      const entrega = sinCeros(f[C.entrega])
      if (!pedido) sinPedido++
      return {
        pedido: pedido || entrega,
        pallet: limpio(f[C.pallet]),
        material: limpio(f[C.material]),
        cajas: numero(f[C.cantidad]),
        lote: limpio(f[C.lote]),
        vencimiento: fecha(f[C.vencimiento]),
        planta: limpio(f[C.planta]),
        fecha: fecha(f[C.fecha]),
        entrega,
        salida: sinCeros(f[C.salida]),
        mix: limpio(f[C.documento]),
        centro: limpio(f[C.centroDestino]) || limpio(f[C.nombreDestino]),
        a_ciegas: !pedido,
      }
    })
    .filter((f) => {
      const vale = f.pedido && f.pallet && f.material && f.cajas > 0
      if (!vale && (f.pallet || f.material)) sinLlave++
      return vale
    })

  if (sinPedido) {
    avisos.push(
      `${sinPedido} filas sin pedido de traslado: se guardan bajo su entrega y esos camiones ` +
        'se reciben a ciegas.',
    )
  }
  if (sinLlave) {
    avisos.push(
      `${sinLlave} filas sin ninguna llave —ni pedido ni entrega— o sin pallet, material o ` +
        'cantidad: no entran. Son pallets ya hechos que todavía no tienen envío.',
    )
  }

  return { kind: 'INGRESO', leidas: filas.length, avisos, ingresos: salida }
}

/**
 * El ZRDT es una sola hoja de 86 columnas. La clave es transporte + entrega + posición, y se
 * comprobó única en las 25,873 filas del extracto de noviembre.
 */
async function despachos(libro: Libro, donde: Donde): Promise<Leido> {
  const { indice, filas } = await filasDe(libro, donde)
  const C = {
    transporte: indice('Número Transporte'),
    entrega: indice('Entrega'),
    posicion: indice('Posición'),
    material: indice('Material'),
    cantidad: indice('Cantidad'),
    um: indice('UM venta'),
    cliente: indice('Nombre Cliente'),
  }

  const avisos: string[] = []
  let enCero = 0
  let sinUm = 0

  const salida = filas
    .map(
      (f): FilaDespacho => ({
        transporte: sinCeros(f[C.transporte]),
        entrega: sinCeros(f[C.entrega]),
        posicion: numero(f[C.posicion]),
        material: limpio(f[C.material]),
        cantidad: numero(f[C.cantidad]),
        um: limpio(f[C.um]),
        cliente: limpio(f[C.cliente]),
      }),
    )
    .filter((f) => {
      if (!f.transporte || !f.material) return false
      if (f.cantidad <= 0) {
        enCero++
        return false
      }
      if (!f.um) {
        sinUm++
        return false
      }
      return true
    })

  if (enCero) {
    avisos.push(`${enCero} líneas con cantidad cero: traen material pero nada que surtir.`)
  }
  if (sinUm) avisos.push(`${sinUm} líneas sin unidad de venta: no se puede saber cuánto es.`)

  return { kind: 'DESPACHO', leidas: filas.length, avisos, despachos: salida }
}

/**
 * La existencia de SAP. La última fila es el total del reporte —viene sin centro— y hay 149
 * filas sin almacén que son existencia en tránsito, con las cuatro cantidades en cero y la
 * columna `Trans./Trasl.` por encima de cero. Esas sí entran.
 */
async function inventario(libro: Libro, donde: Donde): Promise<Leido> {
  const { indice, filas } = await filasDe(libro, donde)
  const C = {
    centro: indice('Centro'),
    almacen: indice('Almacén'),
    material: indice('Material'),
    nombre: indice('Texto breve de material'),
    uom: indice('Unidad medida base'),
    libre: indice('Libre utilización'),
    pendiente: indice('Cantidad pendiente'),
    bloqueado: indice('Bloqueado'),
    transito: indice('Trans./Trasl.'),
  }

  const avisos: string[] = []
  let totales = 0

  const salida = filas
    .map(
      (f): FilaInventario => ({
        centro: limpio(f[C.centro]),
        almacen: limpio(f[C.almacen]),
        material: limpio(f[C.material]),
        nombre: limpio(f[C.nombre]),
        uom: limpio(f[C.uom]) || 'CA',
        libre: numero(f[C.libre]),
        pendiente: numero(f[C.pendiente]),
        bloqueado: numero(f[C.bloqueado]),
        transito: numero(f[C.transito]),
      }),
    )
    .filter((f) => {
      if (!f.centro || !f.material) {
        totales++
        return false
      }
      return true
    })

  if (totales) avisos.push(`${totales} fila de totales del reporte: no entra.`)

  return { kind: 'INVENTARIO', leidas: filas.length, avisos, inventario: salida }
}

/**
 * El pronóstico. Honduras viene partida en «Zona Centro» y «Zona Norte»; se queda la zona de
 * la bodega y se suma por material y mes, que es el grano que el ABC necesita. El archivo se
 * llama «Nov-Ene» pero trae doce meses.
 */
async function pronostico(libro: Libro, donde: Donde, zona: string): Promise<Leido> {
  const { indice, filas } = await filasDe(libro, donde)
  const C = {
    pais: indice('País'),
    material: indice('Material'),
    nombre: indice('Descripción de Material'),
    anio: indice('Año'),
    periodo: indice('Período'),
    pronostico: indice('Pronóstico'),
    pallets: indice('PP'),
    cajasPallet: indice('Cantidad cajas Pallet'),
  }

  const juntas = new Map<string, FilaPronostico>()
  let deLaZona = 0
  let sinEstiba = 0

  for (const f of filas) {
    if (limpio(f[C.pais]) !== zona) continue
    deLaZona++
    const material = limpio(f[C.material])
    const anio = numero(f[C.anio])
    const periodo = numero(f[C.periodo])
    const clave = `${material}|${anio}|${periodo}`
    const previa = juntas.get(clave)
    const cajasPallet = numero(f[C.cajasPallet])
    if (!cajasPallet) sinEstiba++
    if (previa) {
      previa.cajas += numero(f[C.pronostico])
      previa.pallets += numero(f[C.pallets])
    } else {
      juntas.set(clave, {
        zona,
        material,
        nombre: limpio(f[C.nombre]),
        anio,
        periodo,
        cajas: numero(f[C.pronostico]),
        pallets: numero(f[C.pallets]),
        cajas_por_pallet: cajasPallet,
      })
    }
  }

  const avisos: string[] = []
  if (!deLaZona) avisos.push(`El archivo no trae ninguna fila de «${zona}».`)
  if (sinEstiba) {
    avisos.push(`${sinEstiba} filas sin cajas por pallet: de ésas no se puede calcular espacio.`)
  }

  return {
    kind: 'PRONOSTICO',
    leidas: filas.length,
    avisos,
    pronostico: [...juntas.values()],
    resumen: { de_la_zona: deLaZona, materiales: new Set([...juntas.values()].map((f) => f.material)).size },
  }
}

/**
 * El ZMB51. Lo único que sirve para anticipar un ingreso son los movimientos **641**, que son
 * los que traen pedido de traslado: en el extracto de noviembre sus 793 líneas lo traían las
 * 793, y los 29 documentos que cruzaban con el ZRDN eran los 29 de clase 641. Los 303 no
 * traen pedido y no cruzan con nada.
 *
 * SAP lo exporta con dos juegos de rótulos para las mismas columnas —los cortos («CMv»,
 * «Doc.mat.») y los largos («Clase de movimiento», «Documento material»)— y la correspondencia
 * no es la obvia: en los cortos **«Ce.» es la planta que despacha y «Centro» la que recibe**,
 * mientras que en los largos «Centro» es la que despacha y la que recibe se llama «Centro
 * receptor». Se busca cada columna por sus dos nombres y el que exista gana.
 */
async function salidas(libro: Libro, donde: Donde): Promise<Leido> {
  const { indice, filas } = await filasDe(libro, donde)
  const corto = indice('Doc.mat.') >= 0
  const C = {
    material: indice('Material'),
    cantidad: indice('Ctd.en UM entrada'),
    centro: indice(corto ? 'Ce.' : 'Centro'),
    receptor: indice(corto ? 'Centro' : 'Centro receptor'),
    clase: indice(corto ? 'CMv' : 'Clase de movimiento'),
    documento: indice(corto ? 'Doc.mat.' : 'Documento material'),
    pedido: indice('Pedido'),
    fecha: indice(corto ? 'Fe.contab.' : 'Fe.contabilización'),
  }

  const porClase = new Map<string, number>()
  const salida: FilaSalida[] = []

  for (const f of filas) {
    const clase = limpio(f[C.clase])
    if (!clase) continue
    porClase.set(clase, (porClase.get(clase) ?? 0) + 1)
    const pedido = sinCeros(f[C.pedido])
    if (clase !== '641' || !pedido) continue
    salida.push({
      pedido,
      documento: limpio(f[C.documento]),
      material: limpio(f[C.material]),
      cantidad: Math.abs(numero(f[C.cantidad])),
      centro: limpio(f[C.centro]),
      centro_receptor: limpio(f[C.receptor]),
      clase,
      fecha: fecha(f[C.fecha]),
    })
  }

  const avisos: string[] = []
  const con641 = porClase.get('641') ?? 0
  if (!con641) {
    avisos.push(
      'Este extracto no trae ni un movimiento 641, que es el único que lleva pedido de ' +
        'traslado y el único que ata con el ZRDN. Sin ellos no hay nada que cargar: hay que ' +
        'pedir el reporte sin filtrar la clase de movimiento.',
    )
  }

  return {
    kind: 'SALIDAS',
    leidas: filas.length,
    avisos,
    salidas: salida,
    resumen: Object.fromEntries([...porClase].map(([c, n]) => [`clase_${c}`, n])),
  }
}

/**
 * La trazabilidad de NEST baja a nivel de caja: 253,446 en quince días. **No se guarda y no
 * hace falta para nada.** Lo que el WMS necesita —pallet, producto, lote, vencimiento— ya
 * viene en el ZRDN, y se comprobó que coinciden: de los 5,684 pallets en común, el material y
 * el lote cuadran en los 5,684.
 *
 * Y sólo cubre una parte: 144 de los 264 materiales y el 67% de los pallets del ZRDN, porque
 * no todas las plantas etiquetan caja por caja. Por eso no puede ser requisito de nada. Se lee
 * para contarla, decir qué cubrió y dejar constancia de que llegó; tarda dos segundos y no
 * manda ni una fila a la base.
 */
async function traza(libro: Libro, donde: Donde): Promise<Leido> {
  const { indice, filas } = await filasDe(libro, donde)
  const pallets = new Set(filas.map((f) => limpio(f[indice('Pallet Actual')])))
  const materiales = new Set(filas.map((f) => limpio(f[indice('Código Material SAP')])))
  const plantas = new Set(filas.map((f) => limpio(f[indice('Planta')])))
  return {
    kind: 'TRAZA',
    leidas: filas.length,
    avisos: [
      'Este archivo no se guarda ni hace falta: el pallet, el lote y el vencimiento ya vienen ' +
        'en el ZRDN y se comprobó que coinciden. Además sólo lo etiquetan algunas plantas, ' +
        'así que nunca va a estar completo. Queda el registro de que se subió.',
    ],
    resumen: { pallets: pallets.size, materiales: materiales.size, plantas: plantas.size },
  }
}

/** Lee el archivo que sea y devuelve sus filas ya entendidas, o nada si no se reconoce. */
export async function leer(libro: Libro, zonaDelPronostico: string): Promise<Leido | null> {
  const donde = await reconocer(libro)
  if (!donde) return null
  switch (donde.kind) {
    case 'INGRESO':
      return ingresos(libro, donde)
    case 'DESPACHO':
      return despachos(libro, donde)
    case 'INVENTARIO':
      return inventario(libro, donde)
    case 'PRONOSTICO':
      return pronostico(libro, donde, zonaDelPronostico)
    case 'SALIDAS':
      return salidas(libro, donde)
    case 'TRAZA':
      return traza(libro, donde)
  }
}
