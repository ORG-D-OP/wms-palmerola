'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { Icon } from './icon'
import { CAMPO, ETIQUETA } from './campos'
import { useHayCamara } from './hay-camara'
import type { FormatoDeCampo } from '@/lib/warehouse/codigo'

const Camara = dynamic(() => import('./camara').then((m) => m.Camara), { ssr: false })

/**
 * Lo que separa un escaneo de alguien tecleando.
 *
 * Un lector teclea su código en unas decenas de milisegundos; una persona tarda cien y pico
 * por tecla. Con ese margen no hace falta que el lector mande Enter —muchos salen de fábrica
 * sin sufijo y nadie los va a configurar uno por uno— ni que el campo tenga el foco.
 */
const MS_ENTRE_TECLAS = 60
const MS_DE_SILENCIO = 140
const LARGO_MINIMO = 4

/**
 * Qué campo se queda con el escaneo cuando hay dos en pantalla.
 *
 * Pasa de verdad: al recibir un pallet que un camión está esperando aparece el campo del
 * andén para el crossdock, y debajo sigue el de la etiqueta del siguiente pallet. El último
 * que apareció es el que está preguntando, así que es el que escucha; si se cierra, el de
 * abajo vuelve a quedar listo.
 */
const armados: symbol[] = []

/** Un escaneo no es para el campo donde alguien está tecleando a mano. */
function estaEscribiendo(destino: EventTarget | null) {
  const el = destino as HTMLElement | null
  if (!el) return false
  const etiqueta = el.tagName
  return etiqueta === 'INPUT' || etiqueta === 'TEXTAREA' || el.isContentEditable === true
}

/**
 * Campo de escaneo. Va fuera de cualquier render: si se declara dentro, React lo
 * recrea en cada actualizacion y el campo pierde el foco.
 *
 * **Listo para el lector sin que nadie haga nada.** Las teclas se escuchan en la ventana, no
 * en el campo, porque los navegadores de teléfono ignoran el `autofocus` al cargar la página
 * y entonces el lector teclea al vacío. Así el escaneo entra con el campo enfocado o sin
 * enfocar, y lo que va llegando se ve en el campo.
 *
 * Escribir a mano es lo excepcional y hay que pedirlo con el botón del teclado: ahí el campo
 * pasa a ser un campo normal, con Enter para confirmar y sin heurística de tiempos, que es lo
 * único que no se puede mezclar con lo anterior.
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
  const [leyendo, setLeyendo] = useState('')

  const alEscanear = useRef(onScan)
  useEffect(() => {
    alEscanear.current = onScan
  })

  useEffect(() => {
    if (teclado || disabled || camara) return

    const turno = Symbol('escaneo')
    armados.push(turno)

    let texto = ''
    let primera = 0
    let ultima = 0
    let espera = 0

    const soltar = () => {
      const codigo = texto
      texto = ''
      setLeyendo('')
      if (codigo.length < LARGO_MINIMO) return
      // Rápido de más para ser dedos: eso lo tecleó un lector.
      const porTecla = (ultima - primera) / Math.max(1, codigo.length - 1)
      if (porTecla > MS_ENTRE_TECLAS) return
      alEscanear.current(codigo)
    }

    const alTeclear = (e: KeyboardEvent) => {
      if (armados[armados.length - 1] !== turno) return
      if (estaEscribiendo(e.target)) return
      if (e.key === 'Enter') {
        window.clearTimeout(espera)
        const codigo = texto
        texto = ''
        setLeyendo('')
        if (codigo.length === 0) return
        e.preventDefault()
        alEscanear.current(codigo)
        return
      }
      if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return

      const ahora = performance.now()
      // Un silencio largo cierra la ráfaga anterior: lo que sigue es un código nuevo.
      if (ahora - ultima > MS_DE_SILENCIO) {
        texto = ''
        primera = ahora
      }
      ultima = ahora
      texto += e.key
      setLeyendo(texto)

      window.clearTimeout(espera)
      espera = window.setTimeout(soltar, MS_DE_SILENCIO)
    }

    window.addEventListener('keydown', alTeclear)
    return () => {
      window.removeEventListener('keydown', alTeclear)
      window.clearTimeout(espera)
      armados.splice(armados.indexOf(turno), 1)
    }
  }, [teclado, disabled, camara])

  function escribirAMano() {
    setTeclado(true)
    setLeyendo('')
    requestAnimationFrame(() => campo.current?.focus())
  }

  function recibirDeCamara(codigo: string) {
    setCamara(false)
    onScan(codigo)
  }

  return (
    <label className="flex flex-col gap-1.5">
      <span className={ETIQUETA}>{label}</span>
      <span className="relative flex items-center">
        <Icon name="barcode_scanner" className="pointer-events-none absolute left-3 text-azul/40" />
        {teclado ? (
          <input
            ref={campo}
            autoFocus
            disabled={disabled}
            className={`${CAMPO} pr-16 pl-12`}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              onScan(e.currentTarget.value)
              e.currentTarget.value = ''
            }}
          />
        ) : (
          <output
            className={`${CAMPO} flex items-center pr-24 pl-12 tabular-nums ${
              leyendo ? '' : 'text-azul/40'
            }`}
          >
            {leyendo || (disabled ? 'Un momento...' : 'Listo, escanea')}
          </output>
        )}
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
