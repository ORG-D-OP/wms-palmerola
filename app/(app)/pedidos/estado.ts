import type { Database } from '@/lib/database.types'

export const ESTADO: Record<Database['public']['Enums']['order_status'], string> = {
  DRAFT: 'Borrador',
  RELEASED: 'Liberado',
  PICKING: 'En surtido',
  PICKED: 'Surtido',
  SHIPPED: 'Despachado',
  CANCELLED: 'Anulado',
}
