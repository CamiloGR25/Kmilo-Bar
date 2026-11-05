/**
 * Caja: apertura (adelantada a la Fase 4, D-217). D-110: sin caja abierta no se vende.
 * R-PAG-07: solo una caja abierta a la vez. El cierre y el arqueo llegan en la Fase 5.
 */
import type { Cop } from '@/domain/money'

export type CashStatus = 'abierta' | 'cerrada'

export interface CashSession {
  id: string
  number: number
  businessDate: string
  status: CashStatus
  openingBalance: Cop
  openedAt: Date | null
  closedAt: Date | null
}

export class CashError extends Error {
  override name = 'CashError'
}

/** Tope de cordura para el saldo inicial (evita errores de digitación como un cero de más). */
export const MAX_OPENING_BALANCE = 20_000_000

export function validateOpeningBalance(value: number | null): string | null {
  if (value === null) return 'Escribe el saldo inicial (puede ser $ 0).'
  if (!Number.isSafeInteger(value) || value < 0) return 'El saldo debe ser un monto en pesos.'
  if (value > MAX_OPENING_BALANCE) return 'El saldo parece demasiado alto. Revisa la cifra.'
  return null
}
