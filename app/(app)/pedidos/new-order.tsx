'use client'

import { useActionState } from 'react'
import { Aviso } from '@/components/ui/feedback'
import { BOTON, CAMPO, ETIQUETA } from '@/components/ui/campos'
import { createOrder } from './actions'

export function NewOrder({ andenes }: { andenes: { id: string; code: string }[] }) {
  const [estado, accion, pending] = useActionState(createOrder, null)

  return (
    <form action={accion} className="flex flex-col gap-4 rounded-2xl border border-borde p-4">
      <h2 className="text-lg">Nuevo pedido</h2>

      <label className="flex flex-col gap-1.5">
        <span className={ETIQUETA}>Código</span>
        <input name="code" required maxLength={40} className={CAMPO} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={ETIQUETA}>Cliente</span>
        <input name="customer" maxLength={120} className={CAMPO} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={ETIQUETA}>Andén de carga</span>
        <select name="dockDoorId" required defaultValue="" className={CAMPO}>
          <option value="" disabled>
            Elige un andén
          </option>
          {andenes.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code}
            </option>
          ))}
        </select>
      </label>

      <button type="submit" disabled={pending} className={BOTON}>
        {pending ? 'Creando...' : 'Crear pedido'}
      </button>

      {estado && !estado.ok ? <Aviso>{estado.error}</Aviso> : null}
    </form>
  )
}
