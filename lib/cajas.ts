const numero = (n: number) => n.toLocaleString('es-HN')

/** Cuántas cajas completas y cuántas unidades sueltas son una cantidad en unidades base. */
export function desglose(qty: number, porCaja: number) {
  const factor = porCaja > 0 ? porCaja : 1
  const cajas = Math.floor(qty / factor)
  return { cajas, sueltas: Math.round((qty - cajas * factor) * 1000) / 1000 }
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
