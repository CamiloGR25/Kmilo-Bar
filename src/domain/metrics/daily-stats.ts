/**
 * Agregados diarios `dailyStats/{businessDate}` (D-204, adelantados a la Fase 5 por D-219).
 * Cada operación produce un "delta" que el servicio suma con `increment()` en la misma
 * transacción. Así finanzas, gráficas y reportes leen ~1 documento por día.
 *
 * Ventas (F-04) y costo de lo vendido (F-07) se suman cuando la cuenta queda **pagada**;
 * lo cobrado (F-06) se suma con cada pago, aunque sea parcial.
 */
import type { Cop } from '@/domain/money'

export type StatsMethod = 'efectivo' | 'transferencia'
export type StatsChannel = 'nequi' | 'daviplata' | 'banco' | 'breb_qr_llave' | 'otro'

export interface ProductStats {
  name: string
  categoryId: string
  qty: number
  sales: Cop
  cogs: Cop
}

export interface CategoryStats {
  qty: number
  sales: Cop
  cogs: Cop
}

export interface DailyStatsDelta {
  /** F-04: Σ precio × cantidad activa de las cuentas pagadas. */
  salesGross?: Cop
  /** F-07: Σ costo congelado × cantidad activa de las mismas líneas. */
  cogs?: Cop
  ordersCount?: number
  /** F-06: Σ pagos (lo abonado, sin el cambio). */
  collected?: Cop
  /** Parte de F-10: servido y no cobrado, a costo (D-217). */
  orderLosses?: Cop
  byMethod?: Partial<Record<StatsMethod, Cop>>
  byChannel?: Partial<Record<StatsChannel, Cop>>
  byProduct?: Record<string, ProductStats>
  byCategory?: Record<string, CategoryStats>
}

interface StatsLine {
  productId: string
  nameSnap: string
  categoryIdSnap: string
  unitPrice: Cop
  unitCostSnap: Cop
  qty: number
  cancelledQty: number
  lostQty: number
}

/** Delta de una cuenta que queda pagada (F-04, F-07), por producto y por categoría. */
export function paidOrderStats(lines: readonly StatsLine[]): DailyStatsDelta {
  const byProduct: Record<string, ProductStats> = {}
  const byCategory: Record<string, CategoryStats> = {}
  let salesGross = 0
  let cogs = 0
  for (const l of lines) {
    const qty = l.qty - l.cancelledQty - l.lostQty
    if (qty <= 0) continue
    const sales = l.unitPrice * qty
    const cost = l.unitCostSnap * qty
    salesGross += sales
    cogs += cost
    const p = (byProduct[l.productId] ??= {
      name: l.nameSnap,
      categoryId: l.categoryIdSnap,
      qty: 0,
      sales: 0,
      cogs: 0,
    })
    p.qty += qty
    p.sales += sales
    p.cogs += cost
    const c = (byCategory[l.categoryIdSnap || 'sin-categoria'] ??= { qty: 0, sales: 0, cogs: 0 })
    c.qty += qty
    c.sales += sales
    c.cogs += cost
  }
  return { salesGross, cogs, ordersCount: 1, byProduct, byCategory }
}

/** Delta de un pago (F-06): lo abonado, por medio y por canal. */
export function paymentStats(p: {
  method: StatsMethod
  channel: StatsChannel | null
  amount: Cop
}): DailyStatsDelta {
  return {
    collected: p.amount,
    byMethod: { [p.method]: p.amount },
    ...(p.method === 'transferencia' ? { byChannel: { [p.channel ?? 'otro']: p.amount } } : {}),
  }
}

/** Delta de una corrección de medio (D-219): mueve el monto de un medio a otro. */
export function correctionStats(
  from: { method: StatsMethod; channel: StatsChannel | null },
  to: { method: StatsMethod; channel: StatsChannel | null },
  amount: Cop,
): DailyStatsDelta {
  const byMethod: Partial<Record<StatsMethod, Cop>> = {}
  const byChannel: Partial<Record<StatsChannel, Cop>> = {}
  byMethod[from.method] = (byMethod[from.method] ?? 0) - amount
  byMethod[to.method] = (byMethod[to.method] ?? 0) + amount
  if (from.method === 'transferencia') {
    const c = from.channel ?? 'otro'
    byChannel[c] = (byChannel[c] ?? 0) - amount
  }
  if (to.method === 'transferencia') {
    const c = to.channel ?? 'otro'
    byChannel[c] = (byChannel[c] ?? 0) + amount
  }
  return { byMethod, ...(Object.keys(byChannel).length > 0 ? { byChannel } : {}) }
}

/** Delta de unidades servidas y no cobradas (parte de F-10). */
export function lossStats(qty: number, unitCost: Cop): DailyStatsDelta {
  return { orderLosses: qty * unitCost }
}
