/**
 * Mesas — PRODUCT_REQUIREMENTS M4, R-VEN-06 y D-217.
 * ID estable `mesa-{número}`; el número no cambia, el nombre sí.
 */
export type TableStatus = 'disponible' | 'ocupada' | 'por_cobrar' | 'fuera_servicio'

export interface Table {
  id: string
  name: string
  number: number
  status: TableStatus
  currentOrderId: string | null
  active: boolean
  sortOrder: number
}

/** Cinco mesas iniciales (D-000). */
export const INITIAL_TABLE_COUNT = 5

export const TABLE_STATUS_LABELS: Record<TableStatus, string> = {
  disponible: 'Disponible',
  ocupada: 'Ocupada',
  por_cobrar: 'Por cobrar',
  fuera_servicio: 'Fuera de servicio',
}

export const tableIdFor = (number: number) => `mesa-${number}`

export const defaultTableName = (number: number) => `Mesa ${number}`

export function newTable(number: number, name?: string): Omit<Table, 'id'> {
  return {
    name: name?.trim() || defaultTableName(number),
    number,
    status: 'disponible',
    currentOrderId: null,
    active: true,
    sortOrder: number,
  }
}

/** Siguiente número libre (el mayor + 1). */
export function nextTableNumber(tables: readonly Pick<Table, 'number'>[]): number {
  return tables.reduce((max, t) => Math.max(max, t.number), 0) + 1
}

export function validateTableName(name: string): string | null {
  const t = name.trim()
  if (t.length === 0) return 'Escribe el nombre de la mesa.'
  if (t.length > 40) return 'Máximo 40 caracteres.'
  return null
}

/** Una mesa se puede usar para abrir o recibir una cuenta. */
export const isFree = (t: Pick<Table, 'active' | 'status'>) => t.active && t.status === 'disponible'

/** Se puede editar su estado de servicio o desactivar solo si no tiene cuenta. */
export const canChangeService = (t: Pick<Table, 'currentOrderId'>) => t.currentOrderId === null
