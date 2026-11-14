/**
 * «17/03/2027», no «2027-03-17».
 *
 * La base guarda las fechas en ISO y tres pantallas las pintaban tal cual. Quien lee un
 * vencimiento con guantes, a media luz y de reojo, lee `2027-03-17` al revés de como lee las
 * fechas todo el mundo aquí: el día donde va el año.
 *
 * Se arma a mediodía a propósito. `new Date('2027-03-17')` es medianoche **UTC**, que en
 * Honduras es el día anterior a las seis de la tarde, así que la fecha salía corrida un día.
 */
export const fecha = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('es-HN') : '—'
