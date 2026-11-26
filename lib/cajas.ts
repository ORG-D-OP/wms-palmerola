const numero = (n: number) => n.toLocaleString('es-HN')

/**
 * Cuántas cajas completas y cuántas unidades sueltas son una cantidad en unidades base.
 *
 * En unidades enteras, porque media bolsa no existe. Antes redondeaba a tres decimales y lo
 * que salía por pantalla era «4.956 sueltas» y «0.18 sueltas»: el decimal viene de SAP, que
 * cuenta en cajas partidas, y se arrastraba hasta la hoja del chequeador. La misma cuenta
 * que `texto_cajas` en la base.
 */
export function desglose(qty: number, porCaja: number) {
  const factor = porCaja > 0 ? porCaja : 1
  const enteras = Math.round(qty)
  const cajas = Math.floor(enteras / factor)
  return { cajas, sueltas: enteras - cajas * factor }
}

/**
 * Una cantidad dicha como se dice en la bodega.
 *
 * Existe porque el sistema guarda unidades y la gente cuenta cajas, y cada vez que una
 * pantalla se saltó esta conversión terminó enseñando unidades con la palabra «cajas» al
 * lado. Es el mismo texto que arma `texto_cajas` en la base.
 */
export function textoCajas(qty: number, porCaja: number) {
  const { cajas, sueltas } = desglose(qty, porCaja)
  const enCajas = `${numero(cajas)} ${cajas === 1 ? 'caja' : 'cajas'}`
  const enSueltas = `${numero(sueltas)} ${sueltas === 1 ? 'suelta' : 'sueltas'}`
  if (cajas === 0) return enSueltas
  if (sueltas === 0) return enCajas
  return `${enCajas} y ${enSueltas}`
}
