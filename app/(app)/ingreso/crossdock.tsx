'use client'

import { useEffect, useState, useTransition } from 'react'
import { ScanInput } from '@/components/ui/scan-input'
import { Aviso } from '@/components/ui/feedback'
import { BOTON_SUAVE } from '@/components/ui/campos'
import { mandarACrossdock, opcionesCrossdock, type OpcionCrossdock } from './actions'
import { plural } from '@/lib/plural'

/**
 * La salida que se ofrece en el momento en que el sistema acaba de decir dónde guardar.
 *
 * No se pregunta al bajar la carga: hacer que escaneen el andén en cada pallet para un caso
 * excepcional es castigar los cien casos normales. Aquí el operario ya sabe qué tiene en las
 * manos y el sistema ya sabe si algún camión abierto lo necesita; si no lo necesita nadie,
 * este bloque no aparece.
 *
 * Va montado con `key={lpnCode}`: cada pallet es una pregunta nueva, y dejar que React lo
 * vuelva a montar es más barato y más seguro que limpiar el estado a mano.
 */
export function Crossdock({
  lpnCode,
  onEsperandoAnden,
}: {
  lpnCode: string
  /** Mientras se espera el escaneo del andén, el pallet siguiente no se puede escanear. */
  onEsperandoAnden?: (esperando: boolean) => void
}) {
  const [opciones, setOpciones] = useState<OpcionCrossdock[]>([])
  const [elegido, setElegido] = useState<OpcionCrossdock | null>(null)
  const [hecho, setHecho] = useState<{ anden: string; etiqueta: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, empezar] = useTransition()

  useEffect(() => {
    let vigente = true

    opcionesCrossdock(lpnCode).then((res) => {
      if (vigente && res.ok) setOpciones(res.opciones)
    })

    return () => {
      vigente = false
    }
  }, [lpnCode])

  useEffect(() => {
    onEsperandoAnden?.(elegido !== null)
  }, [elegido, onEsperandoAnden])

  const pasar = (anden: string) => {
    if (!elegido || !anden.trim()) return
    setError(null)
    empezar(async () => {
      const res = await mandarACrossdock({ lpnCode, orderId: elegido.orderId, anden })
      if (!res.ok) return setError(res.error)
      setHecho({ anden: res.anden, etiqueta: res.etiqueta })
      setOpciones([])
      setElegido(null)
    })
  }

  if (hecho) {
    return (
      <div className="rounded-2xl bg-[var(--verde)]/20 p-4 text-center">
        <p className="text-sm text-azul/70">No se guarda: va al camión {hecho.etiqueta}</p>
        <p className="text-4xl tabular-nums">{hecho.anden}</p>
      </div>
    )
  }

  if (opciones.length === 0) return null

  if (elegido) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-borde p-4">
        {/*
          No dice «llévalo»: el que recibe no se mueve del andén. Queda pendiente decidir si
          el traslado al andén de carga se convierte en tarea, como el de guardar; mientras
          tanto el texto no le manda a nadie a caminar.
        */}
        <p className="text-sm">
          Va al andén <span className="tabular-nums">{elegido.anden}</span>. Cuando esté allá,
          se escanea para confirmar.
        </p>
        <ScanInput label={`Andén ${elegido.anden}`} disabled={pending} onScan={pasar} />
        <button type="button" onClick={() => setElegido(null)} className={BOTON_SUAVE}>
          Mejor guardarlo
        </button>
        {error ? <Aviso>{error}</Aviso> : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-borde p-4">
      <p className="text-sm text-azul/60">
        {opciones.length === 1 ? 'Un camión está esperando esto:' : 'Hay camiones esperando esto:'}
      </p>
      {opciones.map((o) => (
        <button
          key={o.orderId}
          type="button"
          onClick={() => setElegido(o)}
          className="flex items-baseline justify-between gap-3 rounded-xl bg-azul-08 px-4 py-3 text-left"
        >
          <span>
            <span className="block tabular-nums">{o.anden}</span>
            <span className="block text-xs text-azul/60">
              {o.etiqueta} · le faltan {plural(o.faltanCajas, 'caja', 'cajas')}
            </span>
          </span>
          <span className="text-sm underline underline-offset-4">Mandarlo ahí</span>
        </button>
      ))}
    </div>
  )
}
