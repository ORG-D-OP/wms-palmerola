/**
 * Trae todas las filas de una consulta, no las primeras mil.
 *
 * PostgREST corta cada respuesta en `max_rows`, que en este proyecto es **1,000**, y lo hace
 * en silencio: el `limit(6000)` de la consulta no lo levanta y no llega ningún aviso. Con la
 * bodega llena eso significaba contar mil posiciones de 5,581 y creer que ésas eran todas.
 *
 * Así que se pide por tandas y se para cuando una tanda viene corta. Quien llama arma la
 * consulta **de nuevo en cada tanda**: un constructor de supabase-js no se puede ejecutar dos
 * veces.
 */
const TANDA = 1000

export async function todas<T>(
  tanda: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null }>,
  tope = 20000,
): Promise<T[]> {
  const filas: T[] = []
  for (let desde = 0; desde < tope; desde += TANDA) {
    const { data } = await tanda(desde, desde + TANDA - 1)
    if (!data || data.length === 0) break
    filas.push(...data)
    if (data.length < TANDA) break
  }
  return filas
}
