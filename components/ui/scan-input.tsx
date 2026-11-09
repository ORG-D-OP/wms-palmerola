'use client'

import dynamic from 'next/dynamic'
import { useRef, useState } from 'react'
import { Icon } from './icon'
import { CAMPO, ETIQUETA } from './campos'
import { useHayCamara } from './hay-camara'
import type { FormatoDeCampo } from '@/lib/warehouse/codigo'

const Camara = dynamic(() => import('./camara').then((m) => m.Camara), { ssr: false })

/**
 * Campo de escaneo. Va fuera de cualquier render: si se declara dentro, React lo
 * recrea en cada actualizacion, el campo pierde el foco y el lector deja de servir.
 *
 * Tres formas de llenarlo y una sola salida, `onScan`. El laser teclea el codigo y manda
 * Enter, como cualquier teclado. La camara decodifica y llama la misma funcion. Y el boton
 * del teclado existe porque `inputMode="none"` —necesario para que el teclado del telefono
 * no tape la pantalla cuando hay laser— tambien impide teclear cuando no lo hay.
 *
 * `formato` solo limita a la camara: ahi el operario apunta a una hoja con varios codigos
 * y no elige cual lee. El laser y el teclado quedan libres, que es lo que hace falta
 * mientras los codigos impresos se esten corrigiendo.
 */
export function ScanInput({
  label,
  disabled,
  onScan,
  formato,
}: {
  label: string
  disabled: boolean
  onScan: (code: string) => void
  formato?: FormatoDeCampo
}) {
  const campo = useRef<HTMLInputElement>(null)
  const hayCamara = useHayCamara()
  const [camara, setCamara] = useState(false)
  const [teclado, setTeclado] = useState(false)

  function escribirAMano() {
    setTeclado(true)
    campo.current?.focus()
  }

  function recibirDeCamara(codigo: string) {
    setCamara(false)
    onScan(codigo)
    campo.current?.focus()
  }

  return (
    <label className="flex flex-col gap-1.5">
      <span className={ETIQUETA}>{label}</span>
      <span className="relative flex items-center">
        <Icon name="barcode_scanner" className="pointer-events-none absolute left-3 text-azul/40" />
        <input
          ref={campo}
          autoFocus
          inputMode={teclado ? 'text' : 'none'}
          disabled={disabled}
          className={`${CAMPO} pl-12 pr-24`}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            onScan(e.currentTarget.value)
            e.currentTarget.value = ''
          }}
        />
        <span className="absolute right-2 flex items-center gap-1">
          {!teclado && (
            <button
              type="button"
              onClick={escribirAMano}
              disabled={disabled}
              aria-label="Escribir a mano"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-azul/60 hover:bg-azul-08 disabled:opacity-50"
            >
              <Icon name="keyboard" />
            </button>
          )}
          {hayCamara && (
            <button
              type="button"
              onClick={() => setCamara(true)}
              disabled={disabled}
              aria-label="Escanear con la cámara"
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-azul-08 text-azul hover:bg-azul-15 disabled:opacity-50"
            >
              <Icon name="photo_camera" />
            </button>
          )}
        </span>
      </span>
      {camara && (
        <Camara onLeer={recibirDeCamara} onCerrar={() => setCamara(false)} formato={formato} />
      )}
    </label>
  )
}
