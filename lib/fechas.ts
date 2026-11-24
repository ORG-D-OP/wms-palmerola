/**
 * «17/03/2027», no «2027-03-17».
 *
 * La base guarda las fechas en ISO y tres pantallas las pintaban tal cual. Quien lee un
 * vencimiento con guantes, a media luz y de reojo, lee `2027-03-17` al revés de como lee las
 * fechas todo el mundo aquí: el día donde va el año.
 *
 * Se arma partiendo el texto y no con `Date`. Con `Date` había que pelear dos cosas: la
 * medianoche UTC, que en Honduras es el día anterior, y el idioma del navegador, que si no
 * trae `es-HN` cae en inglés y escribe el mes donde va el día —medido el 24/11/2026 en el
 * tablero: «11/27/2026»—, que es justo lo que esto viene a evitar.
 */
export const fecha = (iso: string | null | undefined) => {
  const [anio, mes, dia] = (iso ?? '').slice(0, 10).split('-')
  return anio && mes && dia ? `${dia}/${mes}/${anio}` : '—'
}
