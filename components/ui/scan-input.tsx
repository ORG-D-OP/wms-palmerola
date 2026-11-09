'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './icon'
import { CAMPO, ETIQUETA } from './campos'
import { useHayCamara } from './hay-camara'
import { useTecladoOculto } from './teclado'
import type { FormatoDeCampo } from '@/lib/warehouse/codigo'

const Camara = dynamic(() => import('./camara').then((m) => m.Camara), { ssr: false })

/**
 * Cuánto se espera, después del último carácter, para dar el código por completo.
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
 * Si en este aparato el lector manda teclas de verdad.
 *
 * Se sabe cuando pasa, no antes: si el código llegó tecla por tecla, hay un lector físico
 * conectado y las teclas se oyen igual sin que el campo tenga el foco. A partir de ahí el
 * campo deja de pedir el foco y el teclado en pantalla no vuelve a salir, que es media
 * pantalla de vuelta en un teléfono. Si el lector resulta ser de los que escriben en el
 * campo como un teclado del sistema, esto nunca se enciende y el foco se cuida como siempre.
 */
let lectorFisico = false

/**
 * Campo de escaneo. Va fuera de cualquier render: si se declara dentro, React lo
 * recrea en cada actualizacion y el campo pierde el foco.
 *
 * **Es un campo de texto normal y corriente, y eso es a propósito.** Un campo normal con el
 * foco puesto es lo único que funciona con todos los lectores: el de láser que teclea, el
 * Bluetooth que teclea despacio y el de los aparatos Android, que no manda teclas sino que
 * escribe en el campo como si fuera un teclado del sistema. Por eso aquí ya no se le dice
 * `inputMode="none"` al navegador para esconder el teclado en pantalla —eso deja fuera al
 * tercero— y por eso el valor no lo maneja React: a un campo controlado el lector le mete el
 * texto y React se lo quita en el mismo parpadeo, y el operario ve el campo vacío. Lo
 * escaneado vive en el DOM y se lee de ahí cuando hay que mandarlo.
 *
 * Encima de eso va lo que falta de fábrica: el foco al entrar —los navegadores de teléfono
 * ignoran el `autofocus` al cargar la página— y el Enter, porque muchos lectores salen sin
 * sufijo y nadie va a configurar treinta aparatos uno por uno. Cuando el texto deja de
 * llegar, el código se da por terminado y se manda solo.
 *
 * Escribir a mano se pide con el botón del teclado: ahí el cierre automático se apaga y vale
 * sólo Enter, que es lo único que no se puede mezclar, porque tecleando despacio cada pausa
 * daría el código por terminado.
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
  const vioTeclas = useRef(false)
  const hayCamara = useHayCamara()
  const [camara, setCamara] = useState(false)
  const [aMano, setAMano] = useState(false)
  const sinTeclado = useTecladoOculto()

  const alEscanear = useRef(onScan)
  useEffect(() => {
    alEscanear.current = onScan
  })

  const soltar = useCallback(() => {
    window.clearTimeout(espera.current)
    const caja = campo.current
    if (!caja) return
    const codigo = caja.value.trim()
    const conTeclas = vioTeclas.current
    caja.value = ''
    vioTeclas.current = false
    if (codigo.length < LARGO_MINIMO) return

    // El código llegó tecleado: hay lector físico, así que se baja el teclado de la pantalla
    // y no se vuelve a pedir el foco. Las teclas se siguen oyendo igual.
    if (conTeclas) {
      lectorFisico = true
      caja.blur()
    }
    alEscanear.current(codigo)
  }, [])

  /** Reinicia la cuenta para cerrar el código. Sólo en modo lector. */
  const programar = useCallback(() => {
    window.clearTimeout(espera.current)
    espera.current = window.setTimeout(soltar, MS_PARA_CERRAR)
  }, [soltar])

  // El foco se pide al entrar y se recupera con cualquier toque en la pantalla, que es la
  // única forma de que los navegadores de teléfono lo concedan.
  useEffect(() => {
    if (camara || disabled || lectorFisico) return

    const enfocar = () => campo.current?.focus({ preventScroll: true })
    enfocar()

    const alTocar = (e: Event) => {
      const destino = e.target as HTMLElement | null
      if (destino?.closest('button, a, select, input, textarea')) return
      enfocar()
    }

    window.addEventListener('pointerdown', alTocar)
    return () => window.removeEventListener('pointerdown', alTocar)
  }, [camara, disabled])

  // Y si aun así el foco se fue a otro lado, el lector teclea al vacío: esas teclas se
  // recogen aquí y se escriben en el campo, para que el operario vea lo que escaneó.
  useEffect(() => {
    if (aMano || camara || disabled) return

    const turno = Symbol('escaneo')
    armados.push(turno)

    const alTeclear = (e: KeyboardEvent) => {
      if (armados[armados.length - 1] !== turno) return
      if (document.activeElement === campo.current) return
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]'))
        return

      if (CIERRES.includes(e.key)) {
        e.preventDefault()
        soltar()
        return
      }
      if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) return

      const caja = campo.current
      if (!caja) return
      vioTeclas.current = true
      caja.value += e.key
      programar()
    }

    window.addEventListener('keydown', alTeclear)
    return () => {
      window.removeEventListener('keydown', alTeclear)
      armados.splice(armados.indexOf(turno), 1)
    }
  }, [aMano, camara, disabled, programar, soltar])

  useEffect(() => () => window.clearTimeout(espera.current), [])

  /** Sin foco el lector escribe en el vacío, así que se recupera salvo que el operario se
   * haya ido a propósito a otro control de la pantalla. */
  function recuperarFoco() {
    if (aMano || camara || disabled || lectorFisico) return
    window.setTimeout(() => {
      const activo = document.activeElement
      if (activo instanceof HTMLElement && activo.closest('button, a, select, input, textarea')) {
        return
      }
      campo.current?.focus({ preventScroll: true })
    }, 0)
  }

  function escribirAMano() {
    window.clearTimeout(espera.current)
    vioTeclas.current = false
    setAMano(true)
    requestAnimationFrame(() => campo.current?.focus())
  }

  function recibirDeCamara(codigo: string) {
    setCamara(false)
    if (campo.current) campo.current.value = ''
    onScan(codigo)
  }

  return (
    <label className="flex flex-col gap-1.5">
      <span className={ETIQUETA}>{label}</span>
      <span className="relative flex items-center">
        <Icon name="barcode_scanner" className="pointer-events-none absolute left-3 text-azul/40" />
        <input
          ref={campo}
          autoFocus={!lectorFisico}
          disabled={disabled}
          inputMode={!aMano && sinTeclado ? 'none' : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="search"
          placeholder={aMano ? '' : 'Listo, escanea'}
          className={`${CAMPO} pl-12 tabular-nums ${aMano ? 'pr-16' : 'pr-24'}`}
          onChange={() => {
            if (!aMano) programar()
          }}
          onBlur={recuperarFoco}
          onKeyDown={(e) => {
            if (e.key.length === 1) vioTeclas.current = true
            if (!CIERRES.includes(e.key)) return
            e.preventDefault()
            soltar()
          }}
        />
        <span className="absolute right-2 flex items-center gap-1">
          {!aMano && (
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
