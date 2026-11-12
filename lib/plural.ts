/**
 * «1 posición», no «1 posiciones».
 *
 * Son pantallas de bodega y los números chicos son lo normal: una posición que contar, una
 * línea sin chequear, una tarea abierta. Estaba escrito con un ternario distinto en cada
 * pantalla y en una se olvidó, que es como salió «1 posiciones» en el panel del jefe.
 */
export const plural = (n: number, singular: string, plural: string) =>
  `${n.toLocaleString('es-HN')} ${n === 1 ? singular : plural}`
