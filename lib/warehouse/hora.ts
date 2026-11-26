/**
 * La hora como la dice la bodega.
 *
 * Dos cosas que no se le pueden dejar al navegador. **La zona**: el servidor corre en UTC y
 * la bodega está en Honduras, así que si no se nombra, la hora que pinta el servidor y la que
 * pinta el teléfono no coinciden; React ve dos textos distintos en el mismo sitio, da la
 * página por mala y la vuelve a dibujar entera desde cero. **El reloj**: en `es-HN` las doce
 * horas terminan en «p. m.», con punto, y cualquier frase que siga queda con dos puntos
 * seguidos. De 24 horas no hay de eso, y en un turno que empieza a las seis de la mañana
 * nadie necesita que se lo aclaren.
 */
const ZONA = 'America/Tegucigalpa'

const reloj = new Intl.DateTimeFormat('es-HN', {
  timeZone: ZONA,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export const hora = (cuando: string | Date) => reloj.format(new Date(cuando))

/**
 * El día y la hora, para los historiales: «25/11, 21:23».
 *
 * Esto estaba escrito a mano y por separado en `/conteos` y en `/datos`, las dos veces sin
 * nombrar la zona. Medido el 25/11/2026: una subida de las **21:23** se leía en pantalla como
 * **«26/11, 03:23 a. m.»** —seis horas de más y el día siguiente—, que es exactamente el
 * desajuste que esta pieza vino a evitar. Un historial con la fecha de mañana no se puede
 * cuadrar contra nada.
 */
const calendario = new Intl.DateTimeFormat('es-HN', {
  timeZone: ZONA,
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export const fechaYHora = (cuando: string | Date | null | undefined) =>
  cuando ? calendario.format(new Date(cuando)) : ''
