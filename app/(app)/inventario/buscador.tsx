'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'

/**
 * La caja de búsqueda del inventario.
 *
 * Esta pantalla se usa de pie en el pasillo con una caja en la mano, así que el campo tiene
 * que estar listo para el lector sin que nadie lo toque y sin pedirle Enter, igual que
 * ingreso y despacho; la ayuda de abajo dice «escanea», y antes no se podía. Lo buscado va
 * en la dirección y no en el estado: así la respuesta se puede recargar o mandar por mensaje.
 */
export function Buscador() {
  const router = useRouter()
  const [pending, empezar] = useTransition()

  return (
    <ScanInput
      label="SKU, DUN-14, pallet o posición"
      disabled={pending}
      onScan={(texto) => empezar(() => router.push(`/inventario?q=${encodeURIComponent(texto)}`))}
    />
  )
}
