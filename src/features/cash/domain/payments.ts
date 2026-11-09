/**
 * Cobros, movimientos de caja y arqueo — BUSINESS_RULES R-PAG-01…07 y D-219.
 * Sin propinas (D-219) y sin anulaciones ni reembolsos de cuentas pagadas (D-219).
 * Lógica pura: los servicios la ejecutan dentro de transacciones de Firestore.
 */
import type { Cop } from '@/domain/money'

// ---------------------------------------------------------------------------
// Medios de pago (R-PAG-01, D-107)
// ---------------------------------------------------------------------------

export type PaymentMethod = 'efectivo' | 'transferencia'
export type TransferChannel = 'nequi' | 'daviplata' | 'banco' | 'breb_qr_llave' | 'otro'

export const CHANNELS: readonly TransferChannel[] = [
  'nequi',
  'daviplata',
  'banco',
  'breb_qr_llave',
  'otro',
]

export const CHANNEL_LABELS: Record<TransferChannel, string> = {
  nequi: 'Nequi',
  daviplata: 'Daviplata',
  banco: 'Banco',
  breb_qr_llave: 'QR / llave Bre-B',
  otro: 'Otro',
}

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
}

export function methodLabel(p: Pick<Payment, 'method' | 'channel'>): string {
  return p.method === 'efectivo' ? 'Efectivo' : CHANNEL_LABELS[p.channel ?? 'otro']
}

export class PaymentError extends Error {
  override name = 'PaymentError'
}

export interface Payment {
  id: string
  orderId: string
  cashSessionId: string
  businessDate: string
  method: PaymentMethod
  channel: TransferChannel | null
  /** Lo que se abona a la cuenta. */
  amount: Cop
  /** Efectivo recibido (solo efectivo). */
  tendered: Cop | null
  /** Cambio entregado: tendered − amount (0 en transferencias). */
  change: Cop
  reference: string | null
  createdAt: Date | null
  /** Corrección del medio (D-219): de qué medio venía. */
  correctedFrom: { method: PaymentMethod; channel: TransferChannel | null } | null
}

/** Campos de un pago nuevo, ya validados. */
export interface PaymentPlan {
  method: PaymentMethod
  channel: TransferChannel | null
  amount: Cop
  tendered: Cop | null
  change: Cop
  reference: string | null
  /** Saldo de la cuenta después del pago. */
  balanceAfter: Cop
}

const isCop = (v: number | null): v is number => v !== null && Number.isSafeInteger(v) && v > 0

/** Tope de cordura para el efectivo recibido (evita un cero de más). */
export const MAX_TENDERED = 10_000_000

/**
 * Pago en efectivo (R-PAG-02): si recibe más que el saldo, se abona el saldo y el resto es
 * cambio; si recibe menos, es un pago parcial.
 */
export function planCashPayment(balance: Cop, tendered: number | null): PaymentPlan {
  if (balance <= 0) throw new PaymentError('La cuenta no tiene saldo por cobrar.')
  if (!isCop(tendered)) throw new PaymentError('Escribe cuánto efectivo recibes.')
  if (tendered > MAX_TENDERED) throw new PaymentError('El monto parece demasiado alto.')
  const amount = Math.min(tendered, balance)
  return {
    method: 'efectivo',
    channel: null,
    amount,
    tendered,
    change: tendered - amount,
    reference: null,
    balanceAfter: balance - amount,
  }
}

/** Pago por transferencia (R-PAG-02): nunca más que el saldo, porque no hay cambio. */
export function planTransferPayment(
  balance: Cop,
  amount: number | null,
  channel: TransferChannel | null,
  reference: string | null,
): PaymentPlan {
  if (balance <= 0) throw new PaymentError('La cuenta no tiene saldo por cobrar.')
  if (!channel) throw new PaymentError('Elige por dónde llegó la transferencia.')
  if (!isCop(amount)) throw new PaymentError('Escribe el monto de la transferencia.')
  if (amount > balance) {
    throw new PaymentError('Una transferencia no puede superar el saldo: no hay cambio.')
  }
  const ref = (reference ?? '').trim().slice(0, 60)
  return {
    method: 'transferencia',
    channel,
    amount,
    tendered: null,
    change: 0,
    reference: ref.length > 0 ? ref : null,
    balanceAfter: balance - amount,
  }
}

/** Billetes sugeridos para cobrar en efectivo: el exacto y los billetes que lo cubren. */
export function cashSuggestions(balance: Cop): Cop[] {
  if (balance <= 0) return []
  const out = new Set<Cop>([balance])
  for (const step of [10_000, 20_000, 50_000, 100_000]) {
    out.add(Math.ceil(balance / step) * step)
  }
  return [...out].sort((a, b) => a - b).slice(0, 4)
}

/**
 * Corrección del medio de pago (D-219): solo cambia cómo entró el dinero, nunca el monto.
 * A efectivo: se recibió justo (sin cambio). A transferencia: no hubo efectivo ni cambio.
 */
export function planMethodCorrection(
  payment: Pick<Payment, 'method' | 'channel' | 'amount'>,
  method: PaymentMethod,
  channel: TransferChannel | null,
) {
  if (method === 'transferencia' && !channel) {
    throw new PaymentError('Elige el canal de la transferencia.')
  }
  const next = method === 'efectivo' ? null : channel
  if (payment.method === method && payment.channel === next) {
    throw new PaymentError('El pago ya está registrado con ese medio.')
  }
  return {
    method,
    channel: next,
    tendered: method === 'efectivo' ? payment.amount : null,
    change: 0,
    correctedFrom: { method: payment.method, channel: payment.channel },
  }
}

// ---------------------------------------------------------------------------
// Movimientos de caja (R-PAG-05)
// ---------------------------------------------------------------------------

/** `pago_proveedor` (Fase 7, D-223 #4) solo lo crea el pago a un proveedor "de la caja". */
export type CashMovementType = 'entrada_extra' | 'retiro_dueno' | 'correccion' | 'pago_proveedor'

export const CASH_MOVEMENT_LABELS: Record<CashMovementType, string> = {
  entrada_extra: 'Entrada extraordinaria',
  retiro_dueno: 'Retiro del dueño',
  correccion: 'Corrección',
  pago_proveedor: 'Pago a proveedor',
}

export interface CashMovement {
  id: string
  sessionId: string
  type: CashMovementType
  /** Con signo: + entra efectivo, − sale. */
  amount: Cop
  reason: string
  createdAt: Date | null
}

/**
 * Valida un movimiento y devuelve el monto con signo. Una salida no puede dejar la caja con
 * efectivo negativo (`cashAvailable` = efectivo esperado en este momento).
 */
export function planCashMovement(
  type: CashMovementType,
  direction: 'entra' | 'sale',
  amount: number | null,
  reason: string,
  cashAvailable: Cop,
): Cop {
  if (!isCop(amount)) throw new PaymentError('Escribe el monto.')
  if (amount > MAX_TENDERED) throw new PaymentError('El monto parece demasiado alto.')
  if (reason.trim().length < 3) throw new PaymentError('Escribe el motivo.')
  const sign =
    type === 'entrada_extra' ? 1 : type === 'retiro_dueno' ? -1 : direction === 'entra' ? 1 : -1
  if (sign < 0 && amount > cashAvailable) {
    throw new PaymentError('No hay tanto efectivo en la caja.')
  }
  return sign * amount
}

// ---------------------------------------------------------------------------
// Arqueo y cierre (R-PAG-05, R-PAG-06)
// ---------------------------------------------------------------------------

export interface SessionTotals {
  /** Σ pagos en efectivo (lo abonado; el cambio no es ingreso). */
  cash: Cop
  /** Σ transferencias. */
  transfer: Cop
  byChannel: Record<TransferChannel, Cop>
  /** Cambio entregado (informativo). */
  change: Cop
  movementsIn: Cop
  movementsOut: Cop
  paymentsCount: number
}

export function sessionTotals(
  payments: readonly Pick<Payment, 'method' | 'channel' | 'amount' | 'change'>[],
  movements: readonly Pick<CashMovement, 'amount'>[],
): SessionTotals {
  const byChannel = Object.fromEntries(CHANNELS.map((c) => [c, 0])) as Record<TransferChannel, Cop>
  let cash = 0
  let transfer = 0
  let change = 0
  for (const p of payments) {
    if (p.method === 'efectivo') cash += p.amount
    else {
      transfer += p.amount
      byChannel[p.channel ?? 'otro'] += p.amount
    }
    change += p.change
  }
  let movementsIn = 0
  let movementsOut = 0
  for (const m of movements) {
    if (m.amount > 0) movementsIn += m.amount
    else movementsOut += -m.amount
  }
  return {
    cash,
    transfer,
    byChannel,
    change,
    movementsIn,
    movementsOut,
    paymentsCount: payments.length,
  }
}

/**
 * R-PAG-05 (sin propinas, D-219): efectivo esperado = saldo inicial + pagos en efectivo
 * + entradas − salidas.
 */
export function expectedCash(openingBalance: Cop, totals: SessionTotals): Cop {
  return openingBalance + totals.cash + totals.movementsIn - totals.movementsOut
}

/** Tope de cordura para el efectivo contado al cierre (evita ceros de más). */
export const MAX_COUNTED = 100_000_000

/** R-PAG-06: diferencia = contado − esperado (positiva: sobra; negativa: falta). */
export function cashDifference(counted: Cop, expected: Cop): Cop {
  return counted - expected
}

export function validateClosing(
  counted: number | null,
  expected: Cop,
  reason: string,
  openOrders: number,
): string | null {
  // R-PAG-06: no se cierra con cuentas abiertas.
  if (openOrders > 0) {
    return openOrders === 1
      ? 'Hay 1 cuenta abierta. Cóbrala o ciérrala antes de cerrar la caja.'
      : `Hay ${openOrders} cuentas abiertas. Cóbralas o ciérralas antes de cerrar la caja.`
  }
  if (counted === null || !Number.isSafeInteger(counted) || counted < 0) {
    return 'Escribe el efectivo que contaste (puede ser $ 0).'
  }
  if (counted > MAX_COUNTED) return 'El monto contado parece demasiado alto. Revisa la cifra.'
  if (cashDifference(counted, expected) !== 0 && reason.trim().length < 3) {
    return 'Hay diferencia: escribe el motivo.'
  }
  return null
}
