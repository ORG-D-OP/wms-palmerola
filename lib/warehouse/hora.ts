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
