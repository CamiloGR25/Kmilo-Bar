/**
 * Caja: apertura (Fase 4, D-217) y cierre con arqueo (Fase 5, R-PAG-06).
 * D-110: sin caja abierta no se vende. R-PAG-07: solo una caja abierta a la vez.
 */
import type { Cop } from '@/domain/money'
import type { TransferChannel } from './payments'

export type CashStatus = 'abierta' | 'cerrada'

export interface CashSession {
  id: string
  number: number
  businessDate: string
  status: CashStatus
  openingBalance: Cop
  openedAt: Date | null
  closedAt: Date | null
  /** Datos del cierre (null mientras está abierta). */
  closing: CashClosing | null
}

/** Resumen guardado en la caja al cerrarla: el historial no vuelve a leer pagos ni cuentas. */
export interface CashSummary {
  sales: Cop
  ordersPaid: number
  ordersNoConsumption: number
  cash: Cop
  transfer: Cop
  byChannel: Record<TransferChannel, Cop>
  change: Cop
  movementsIn: Cop
  movementsOut: Cop
  paymentsCount: number
}

export interface CashClosing {
  expectedCash: Cop
  countedCash: Cop
  /** contado − esperado (R-PAG-06). */
  difference: Cop
  differenceReason: string | null
  summary: CashSummary
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
