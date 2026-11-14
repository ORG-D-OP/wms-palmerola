/**
 * «Andén 9», no «STG-AND-09».
 *
 * `STG-AND-09` es el nombre interno de la posición de piso del andén 9, y salía en crudo en
 * Guardar y en Surtir. A la persona hay que decirle lo que está pintado en la pared, que es lo
 * único que va a buscar. Las posiciones de rack sí se dicen como son —`F3-024-01` es lo que
 * lleva la etiqueta del bastidor—, así que esas pasan tal cual.
 */
const ANDEN = /^(?:STG-)?AND-0*(\d+)$/

export const nombrePosicion = (code: string | null | undefined) => {
  if (!code) return ''
  const anden = code.match(ANDEN)
  return anden ? `Andén ${anden[1]}` : code
}
