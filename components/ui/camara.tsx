'use client'

import { useEffect, useRef, useState } from 'react'
import { abrirLector, type Lectura } from '@/lib/warehouse/lector'
import { Icon } from './icon'

/** Cada cuanto se mira el video donde el navegador no avisa de cuadro nuevo. */
const MS_ENTRE_INTENTOS = 120

/** Tropiezos seguidos del decodificador antes de rendirse y decirlo. */
const TOPE_FALLOS = 10

type VideoConCuadros = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number
}

/** `torch` y `focusMode` existen en los navegadores moviles pero no en los tipos del DOM. */
type AjusteCamara = MediaTrackConstraintSet & { torch?: boolean; focusMode?: string }

/** Decir cual de todas fallo ahorra media hora de adivinar frente al telefono. */
const MOTIVOS: Record<string, string> = {
  NotAllowedError: 'El navegador negó la cámara. Dale permiso al sitio y vuelve a intentar.',
  NotFoundError: 'Este aparato no tiene ninguna cámara disponible.',
  NotReadableError: 'Otra aplicación está usando la cámara. Ciérrala y vuelve a intentar.',
  OverconstrainedError: 'La cámara del aparato no acepta la calidad que se le pidió.',
  SecurityError: 'La cámara sólo funciona sobre HTTPS.',
}

/**
 * Lee con la camara del telefono. Existe porque los lectores laser son pocos y la mayoria
 * de la gente va a andar con un telefono normal.
 */
export function Camara({
  onLeer,
  onCerrar,
}: {
  onLeer: (codigo: string) => void
  onCerrar: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const pista = useRef<MediaStreamTrack | null>(null)
  const alLeer = useRef(onLeer)
  const [error, setError] = useState('')
  const [motor, setMotor] = useState('')
  const [descartada, setDescartada] = useState<Lectura | null>(null)
  const [encendida, setEncendida] = useState(false)
  const [hayLinterna, setHayLinterna] = useState(false)

  useEffect(() => {
    alLeer.current = onLeer
  })

  // Sin dependencias a proposito: la camara se abre una vez y no se reinicia porque la
  // pantalla de arriba se haya vuelto a dibujar.
  useEffect(() => {
    const elemento = video.current
    if (!elemento) return

    let vivo = true
    let espera = 0
    let fallos = 0
    let camara: MediaStream | null = null

    // Con `conCuadro` se espera al siguiente cuadro del video; sin el, al reloj. Lo segundo
    // hace falta mientras el video no arranca: ahi no hay cuadros que esperar y el bucle
    // se quedaria colgado para siempre.
    const programar = (conCuadro: boolean, seguir: () => void) => {
      if (!vivo) return
      const conCuadros = elemento as VideoConCuadros
      if (conCuadro && conCuadros.requestVideoFrameCallback) {
        conCuadros.requestVideoFrameCallback(seguir)
      } else {
        espera = window.setTimeout(seguir, MS_ENTRE_INTENTOS)
      }
    }

    const arrancar = async () => {
      try {
        camara = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        })
      } catch (falla) {
        const causa = falla instanceof Error ? falla.name : ''
        setError(MOTIVOS[causa] ?? `No se pudo abrir la cámara (${causa || 'causa desconocida'}).`)
        return
      }
      if (!vivo) {
        camara.getTracks().forEach((t) => t.stop())
        return
      }

      elemento.srcObject = camara
      await elemento.play().catch(() => {})

      const track = camara.getVideoTracks()[0] ?? null
      pista.current = track
      if (track) {
        // Sin enfoque continuo un codigo de barras lineal sencillamente no entra.
        const enfoque: AjusteCamara = { focusMode: 'continuous' }
        await track.applyConstraints({ advanced: [enfoque] }).catch(() => {})
        setHayLinterna('torch' in (track.getCapabilities?.() ?? {}))
      }

      const lector = await abrirLector()
      if (!vivo) return
      setMotor(lector.motor)

      const lienzo = document.createElement('canvas')
      const pincel = lienzo.getContext('2d', { willReadFrequently: true })
      if (!pincel) {
        setError('Este navegador no puede procesar el video de la cámara.')
        return
      }

      const mirar = async (): Promise<void> => {
        if (!vivo) return
        const ancho = elemento.videoWidth
        const alto = elemento.videoHeight
        if (!ancho || !alto) return programar(false, () => void mirar())

        lienzo.width = ancho
        lienzo.height = alto
        pincel.drawImage(elemento, 0, 0, ancho, alto)

        let lecturas: Lectura[] = []
        try {
          lecturas = await lector.leer(pincel.getImageData(0, 0, ancho, alto))
          fallos = 0
        } catch {
          // Un tropiezo del decodificador no puede matar el bucle. Sin esto la camara se
          // queda abierta, encendida, y no vuelve a leer nunca: parece que no pasa nada.
          fallos += 1
          if (fallos >= TOPE_FALLOS) {
            vivo = false
            setError(`El decodificador (${lector.motor}) falló varias veces seguidas.`)
            return
          }
        }
        if (!vivo) return

        const buena = lecturas.find((lectura) => lectura.confiable)
        if (buena) {
          // Una sola lectura por apertura, asi que no hay forma de contar dos veces el
          // mismo pallet. En bodega con ruido la vibracion le gana al pitido.
          vivo = false
          navigator.vibrate?.(60)
          alLeer.current(buena.texto)
          return
        }

        setDescartada(lecturas[0] ?? null)
        programar(true, () => void mirar())
      }

      void mirar()
    }

    void arrancar()

    return () => {
      vivo = false
      window.clearTimeout(espera)
      pista.current = null
      camara?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  async function alternarLinterna() {
    const track = pista.current
    if (!track) return
    const linterna: AjusteCamara = { torch: !encendida }
    await track
      .applyConstraints({ advanced: [linterna] })
      .then(() => setEncendida(!encendida))
      .catch(() => setHayLinterna(false))
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="relative flex-1 overflow-hidden">
        <video ref={video} autoPlay playsInline muted className="h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-6 rounded-2xl border-2 border-celeste/70" />

        <p className="absolute inset-x-4 bottom-6 text-center text-white/80">
          {error ? (
            <span role="alert" className="text-lg text-white">
              {error}
            </span>
          ) : descartada ? (
            <>
              Leí <span className="tabular-nums">{descartada.texto}</span> y no es un código
              completo. Acércate un poco más.
            </>
          ) : (
            <>Centra el código y acerca el teléfono a unos 20 cm</>
          )}
        </p>

        {motor && !error ? (
          <p className="absolute inset-x-4 top-4 text-center text-xs text-white/40">
            Leyendo con {motor}
          </p>
        ) : null}
      </div>

      <div className="flex gap-3 p-4">
        <button
          type="button"
          onClick={onCerrar}
          className="flex h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-white text-lg text-azul"
        >
          <Icon name="close" />
          Cerrar
        </button>
        {hayLinterna && (
          <button
            type="button"
            onClick={() => void alternarLinterna()}
            aria-pressed={encendida}
            aria-label="Linterna"
            className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/40 text-white"
          >
            <Icon name={encendida ? 'flashlight_off' : 'flashlight_on'} />
          </button>
        )}
      </div>
    </div>
  )
}
