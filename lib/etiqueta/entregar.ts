/**
 * Llevar el ZPL del teléfono a la impresora.
 *
 * La aplicación corre en Vercel y la impresora tiene dirección privada: el servidor no la
 * alcanza nunca. El teléfono sí, porque está en la misma red de la bodega, así que la entrega
 * la hace el navegador y no el servidor.
 *
 * La Zebra atiende ZPL en `POST /pstprnt` de su propio servidor web, con el ZPL crudo como
 * cuerpo (comprobado contra la ZD421 el 28/11/2026). No devuelve cabeceras CORS, así que la
 * respuesta no se puede leer y el envío va en `no-cors`: que no lance es todo lo que se puede
 * saber desde aquí. Quien de verdad confirma que salió es la persona que la ve salir.
 *
 * `targetAddressSpace` es lo que hace posible todo esto. Una página servida por HTTPS no puede
 * hablar con un `http://` —el navegador lo llama contenido mixto y lo bloquea, comprobado—,
 * pero desde Chrome 142 las peticiones a la red local son una excepción si el navegador sabe
 * de antemano que el destino es local. Declararlo es lo que la marca como tal. A cambio, Chrome
 * le pide permiso a la persona la primera vez, y por eso esto sólo se llama al apretar un botón:
 * el permiso no se concede sin un gesto.
 */

/** `targetAddressSpace` es de Chrome y aún no está en los tipos del DOM. */
type PeticionLocal = RequestInit & { targetAddressSpace?: 'local' | 'private' | 'public' }

export type Entrega = { ok: true } | { ok: false; error: string }

export async function entregarALaImpresora(impresora: string, zpl: string): Promise<Entrega> {
  if (!impresora) {
    return { ok: false, error: 'Este despliegue no tiene impresora configurada.' }
  }

  try {
    await fetch(`${impresora.replace(/\/+$/, '')}/pstprnt`, {
      method: 'POST',
      mode: 'no-cors',
      targetAddressSpace: 'local',
      headers: { 'Content-Type': 'text/plain' },
      body: zpl,
    } as PeticionLocal)
    return { ok: true }
  } catch {
    return {
      ok: false,
      error:
        'El teléfono no alcanzó la impresora. Comprueba que estés en la red de la bodega y que le hayas dado permiso al navegador.',
    }
  }
}

/**
 * Si el navegador ya tiene permiso para hablar con la red de la bodega.
 *
 * Sirve para avisar antes de que la persona apriete, no para decidir: donde el navegador no
 * conozca este permiso, la consulta falla y lo que toca es intentar la impresión igual.
 */
export async function permisoDeRedLocal(): Promise<PermissionState | 'desconocido'> {
  try {
    const estado = await navigator.permissions.query({
      name: 'local-network' as PermissionName,
    })
    return estado.state
  } catch {
    return 'desconocido'
  }
}
