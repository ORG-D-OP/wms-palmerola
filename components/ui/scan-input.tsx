'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './icon'
import { CAMPO, ETIQUETA } from './campos'
import { useHayCamara } from './hay-camara'
import type { FormatoDeCampo } from '@/lib/warehouse/codigo'

const Camara = dynamic(() => import('./camara').then((m) => m.Camara), { ssr: false })

/**
 * Cuánto se espera, después de la última tecla, para dar el código por completo.
 *
 * Un lector teclea todo el código de corrido; este silencio es el final de la ráfaga. No se
 * mide la velocidad —hay lectores Bluetooth que teclean lento— porque en modo lector nadie
 * está escribiendo a mano: cualquier texto que deja de llegar es un código terminado.
 */
const MS_PARA_CERRAR = 250
const LARGO_MINIMO = 3

/** Teclas con las que un lector cierra el código, cuando viene configurado para mandar algo. */
const CIERRES = ['Enter', 'Tab']

/**
 * Qué campo se queda con el escaneo cuando hay dos en pantalla.
 *
 * El último que apareció es el que está preguntando, así que es el que escucha; si se cierra,
 * el de abajo vuelve a quedar listo.
 */
const armados: symbol[] = []

/**
 * Campo de escaneo. Va fuera de cualquier render: si se declara dentro, React lo
 * recrea en cada actualizacion y el campo pierde el foco.
 *
 * **Listo para el lector sin que nadie haga nada, y sin pedirle Enter.** Dos cosas que no se
 * pueden dar por hechas: que el campo tenga el foco —los navegadores de teléfono ignoran el
 * `autofocus` al cargar la página— y que el lector venga configurado con sufijo Enter, porque
 * muchos salen de fábrica sin él y nadie va a configurar treinta aparatos uno por uno. Así
 * que las teclas se recogen también desde la ventana cuando el campo no tiene el foco, y el
 * código se cierra solo cuando dejan de llegar.
 *
 * Escribir a mano se pide con el botón del teclado. Ahí el cierre automático se apaga y vale
 * sólo Enter, que es lo único que no se puede mezclar: tecleando despacio, cada pausa daría
 * el código por terminado.
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
  const espera = useRef(0)
  const hayCamara = useHayCamara()
  const [camara, setCamara] = useState(false)
  const [teclado, setTeclado] = useState(false)
  const [valor, setValor] = useState('')

  // El valor tambien en un ref: el cierre automatico corre desde un reloj, fuera de React, y
  // ahi no hay forma de leer el estado de la ultima vuelta.
  const valorRef = useRef('')
  const alEscanear = useRef(onScan)
  useEffect(() => {
    valorRef.current = valor
    alEscanear.current = onScan
  })

  const escribir = useCallback((texto: string) => {
    valorRef.current = texto
    setValor(texto)
  }, [])

  const soltar = useCallback(() => {
    window.clearTimeout(espera.current)
    const codigo = valorRef.current.trim()
    escribir('')
    if (codigo.length >= LARGO_MINIMO) alEscanear.current(codigo)
  }, [escribir])

  /** Reinicia la cuenta para cerrar el código. Sólo en modo lector. */
  const programar = useCallback(() => {
    window.clearTimeout(espera.current)
    espera.current = window.setTimeout(soltar, MS_PARA_CERRAR)
  }, [soltar])

  // El foco se intenta al montar y se recupera con cualquier toque en la pantalla, que es la
  // única forma de que los navegadores de teléfono lo concedan.
  useEffect(() => {
    if (teclado || camara || disabled) return

    const enfocar = () => campo.current?.focus({ preventScroll: true })
    enfocar()

    const alTocar = (e: Event) => {
      const destino = e.target as HTMLElement | null
      if (destino?.closest('button, a, select, input, textarea')) return
      enfocar()
    }

    window.addEventListener('pointerdown', alTocar)
    return () => window.removeEventListener('pointerdown', alTocar)
  }, [teclado, camara, disabled])

  // Cuando el campo no tiene el foco, el lector teclea al vacío: estas teclas se recogen aquí.
  useEffect(() => {
    if (teclado || camara || disabled) return

    const turno = Symbol('escaneo')
    armados.push(turno)

    const alTeclear = (e: KeyboardEvent) => {
      if (armados[armados.length - 1] !== turno) return
      if (document.activeElement === campo.current) return
      const dentroDeOtroCampo = (e.target as HTMLElement | null)?.closest(
        'input, textarea, select, [contenteditable]',
      )
      if (dentroDeOtroCampo) return

      if (CIERRES.includes(e.key)) {
        e.preventDefault()
        soltar()
        return
      }
      if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return

      escribir(valorRef.current + e.key)
      programar()
    }

    window.addEventListener('keydown', alTeclear)
    return () => {
      window.removeEventListener('keydown', alTeclear)
      armados.splice(armados.indexOf(turno), 1)
    }
  }, [teclado, camara, disabled, programar, soltar, escribir])

  useEffect(() => () => window.clearTimeout(espera.current), [])

  function escribirAMano() {
    window.clearTimeout(espera.current)
    setTeclado(true)
    requestAnimationFrame(() => campo.current?.focus())
  }

  function recibirDeCamara(codigo: string) {
    setCamara(false)
    escribir('')
    onScan(codigo)
  }

  return (
    <label className="flex flex-col gap-1.5">
      <span className={ETIQUETA}>{label}</span>
      <span className="relative flex items-center">
        <Icon name="barcode_scanner" className="pointer-events-none absolute left-3 text-azul/40" />
        <input
          ref={campo}
          autoFocus
          value={valor}
          disabled={disabled}
          inputMode={teclado ? 'text' : 'none'}
          autoComplete="off"
          placeholder={teclado ? '' : 'Listo, escanea'}
          className={`${CAMPO} pl-12 tabular-nums ${teclado ? 'pr-16' : 'pr-24'}`}
          onChange={(e) => {
            escribir(e.target.value)
            if (!teclado) programar()
          }}
          onKeyDown={(e) => {
            if (!CIERRES.includes(e.key)) return
            e.preventDefault()
            soltar()
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
