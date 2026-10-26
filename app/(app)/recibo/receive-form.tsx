'use client'

import { useRef, useState, useTransition } from 'react'
import { receivePallet, resolveBarcode, type Match } from './actions'

type Dock = { id: string; code: string }
type Done = { lpnCode: string; locationCode: string | null }

const campo = 'h-14 w-full rounded-lg border border-black/15 px-3 text-lg dark:border-white/20'
const boton = 'h-14 w-full rounded-lg bg-foreground text-lg font-medium text-background disabled:opacity-60'

export function ReceiveForm({ docks }: { docks: Dock[] }) {
  const [dockId, setDockId] = useState(docks[0]?.id ?? '')
  const [matches, setMatches] = useState<Match[] | null>(null)
  const [match, setMatch] = useState<Match | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const scanRef = useRef<HTMLInputElement>(null)

  const reiniciar = () => {
    setMatches(null)
    setMatch(null)
    setDone(null)
    setError(null)
    scanRef.current?.focus()
  }

  const escanear = (code: string) => {
    if (!code.trim()) return
    setError(null)
    startTransition(async () => {
      const res = await resolveBarcode(code)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setMatches(res.matches)
      if (res.matches.length === 1) setMatch(res.matches[0] ?? null)
    })
  }

  const guardar = (formData: FormData) => {
    if (!match) return
    formData.set('productId', match.productId)
    formData.set('packagingLevelId', match.packagingLevelId)
    formData.set('dockLocationId', dockId)
    formData.set('idempotencyKey', crypto.randomUUID())
    startTransition(async () => {
      const res = await receivePallet(formData)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setDone({ lpnCode: res.lpnCode, locationCode: res.locationCode })
    })
  }

  if (done) {
    return (
      <div className="flex flex-col gap-6 text-center">
        <div>
          <p className="text-sm uppercase tracking-wide opacity-60">Matricula</p>
          <p className="text-3xl font-semibold tabular-nums">{done.lpnCode}</p>
        </div>
        <div>
          <p className="text-sm uppercase tracking-wide opacity-60">Llevalo a</p>
          <p className="text-4xl font-bold tabular-nums">{done.locationCode ?? 'Sin hueco libre'}</p>
        </div>
        <button type="button" onClick={reiniciar} className={boton}>
          Recibir otro
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Anden</span>
        <select
          value={dockId}
          onChange={(e) => setDockId(e.target.value)}
          className={campo}
        >
          {docks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code}
            </option>
          ))}
        </select>
      </label>

      {!match ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Escanea el codigo de la caja</span>
          <input
            ref={scanRef}
            autoFocus
            inputMode="none"
            disabled={pending}
            className={campo}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              escanear(e.currentTarget.value)
              e.currentTarget.value = ''
            }}
          />
        </label>
      ) : null}

      {matches && matches.length > 1 && !match ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Ese codigo es de varios productos. ¿Cual es?</p>
          {matches.map((m) => (
            <button
              key={m.packagingLevelId}
              type="button"
              onClick={() => setMatch(m)}
              className="rounded-lg border border-black/15 p-3 text-left dark:border-white/20"
            >
              <span className="block font-medium">{m.name}</span>
              <span className="block text-sm opacity-60">{m.sku}</span>
            </button>
          ))}
        </div>
      ) : null}

      {match ? (
        <form action={guardar} className="flex flex-col gap-4">
          <div className="rounded-lg border border-black/10 p-3 dark:border-white/15">
            <p className="font-medium">{match.name}</p>
            <p className="text-sm opacity-60">
              {match.sku} · {match.packagingCode} de {match.qtyBaseUnits}
            </p>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Cajas</span>
            <input
              name="qty"
              type="number"
              inputMode="numeric"
              min={1}
              required
              defaultValue={match.casesPerPallet ?? undefined}
              className={campo}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Lote</span>
            <input name="lot" className={campo} />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">
              Vencimiento {match.requiresFefo ? '(obligatorio)' : ''}
            </span>
            <input
              name="expiry"
              type="date"
              required={match.requiresFefo}
              className={campo}
            />
          </label>

          <button type="submit" disabled={pending} className={boton}>
            {pending ? 'Guardando...' : 'Recibir'}
          </button>
          <button type="button" onClick={reiniciar} className="text-sm underline underline-offset-4">
            Cancelar
          </button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  )
}
