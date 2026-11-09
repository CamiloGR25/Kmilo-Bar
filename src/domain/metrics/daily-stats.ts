/**
 * Agregados diarios `dailyStats/{businessDate}` (D-204, adelantados a la Fase 5 por D-219).
 * Cada operación produce un "delta" que el servicio suma con `increment()` en la misma
 * transacción. Así finanzas, gráficas y reportes leen ~1 documento por día.
 *
 * Ventas (F-04) y costo de lo vendido (F-07) se suman cuando la cuenta queda **pagada**;
 * lo cobrado (F-06) se suma con cada pago, aunque sea parcial.
 */
import { daysBetween, hourOf, type BusinessDate } from '@/domain/dates'
import type { Cop } from '@/domain/money'

export type StatsMethod = 'efectivo' | 'transferencia'
export type StatsChannel = 'nequi' | 'daviplata' | 'banco' | 'breb_qr_llave' | 'otro'

/**
 * Salidas de inventario sin venta (F-10, D-221), valoradas al costo promedio del momento.
 * `servido_no_cobrado` no es un movimiento: viene de las cuentas (D-217) y va en `orderLosses`.
 */
export const INVENTORY_LOSS_KEYS = [
  'merma',
  'danado',
  'vencido',
  'cortesia',
  'consumo_propio',
  'ajuste_negativo',
  'conteo',
] as const
export type InventoryLossKey = (typeof INVENTORY_LOSS_KEYS)[number]

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
  /** F-10 (D-221): salidas de inventario sin venta, a costo. */
  invLosses?: Cop
  /** Sobrantes: ajustes positivos y conteos con más unidades de las del sistema, a costo. */
  invGains?: Cop
  byLossType?: Partial<Record<InventoryLossKey, Cop>>
  /** Fase 7 (R-COM-06): mercancía recibida a costo real; no es gasto, sube el inventario. */
  purchases?: Cop
  /** Fase 7: pagos a proveedores (para el flujo de caja, F-13); `supplierPaidCash` salió de la caja. */
  supplierPaid?: Cop
  supplierPaidCash?: Cop
  /** Ventas por hora de Bogotá ("0"…"23") según la hora en que se confirmó cada ronda (D-221). */
  byHour?: Record<string, Cop>
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
  /** Hora en que se confirmó la ronda (para `byHour`). */
  addedAt?: Date | null
}

/**
 * Delta de una cuenta que queda pagada (F-04, F-07), por producto, categoría y hora.
 * `fallbackAt` se usa para las líneas sin hora de confirmación; sin él no se calcula `byHour`.
 */
export function paidOrderStats(lines: readonly StatsLine[], fallbackAt?: Date): DailyStatsDelta {
  const byHour: Record<string, Cop> = {}
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
    const at = l.addedAt ?? fallbackAt
    if (at) {
      const h = String(hourOf(at))
      byHour[h] = (byHour[h] ?? 0) + sales
    }
  }
  return {
    salesGross,
    cogs,
    ordersCount: 1,
    byProduct,
    byCategory,
    ...(Object.keys(byHour).length > 0 ? { byHour } : {}),
  }
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

/**
 * Delta de un movimiento de inventario (F-10, D-221). `qty` lleva el signo del movimiento y
 * `unitCost` es el costo con el que se valoró. Las salidas sin venta suman a `invLosses`; los
 * sobrantes (ajuste positivo, conteo positivo) a `invGains`. Ventas, entradas y devoluciones
 * no producen delta.
 */
export function inventoryMovementStats(type: string, qty: number, unitCost: Cop): DailyStatsDelta {
  const value = Math.abs(qty) * unitCost
  if (value === 0) return {}
  if (type === 'ajuste_positivo' || (type === 'conteo' && qty > 0)) return { invGains: value }
  if ((INVENTORY_LOSS_KEYS as readonly string[]).includes(type) && qty < 0) {
    return { invLosses: value, byLossType: { [type as InventoryLossKey]: value } }
  }
  return {}
}

type NumMap = Partial<Record<string, number>>

function addMaps(a: NumMap | undefined, b: NumMap | undefined): NumMap | undefined {
  if (!a) return b && { ...b }
  if (!b) return { ...a }
  const out: NumMap = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + (v ?? 0)
  return out
}

/** Suma varios deltas (p. ej. los de un lote de conteo, que escriben un solo `dailyStats`). */
export function mergeDeltas(...deltas: DailyStatsDelta[]): DailyStatsDelta {
  const out: DailyStatsDelta = {}
  const nums = [
    'salesGross',
    'cogs',
    'ordersCount',
    'collected',
    'orderLosses',
    'invLosses',
    'invGains',
    'purchases',
    'supplierPaid',
    'supplierPaidCash',
  ] as const
  for (const d of deltas) {
    for (const k of nums) if (d[k] !== undefined) out[k] = (out[k] ?? 0) + d[k]!
    out.byMethod = addMaps(out.byMethod, d.byMethod)
    out.byChannel = addMaps(out.byChannel, d.byChannel)
    out.byLossType = addMaps(out.byLossType, d.byLossType)
    out.byHour = addMaps(out.byHour, d.byHour) as Record<string, Cop> | undefined
    for (const [id, p] of Object.entries(d.byProduct ?? {})) {
      out.byProduct ??= {}
      const cur = out.byProduct[id]
      out.byProduct[id] = cur
        ? { ...cur, qty: cur.qty + p.qty, sales: cur.sales + p.sales, cogs: cur.cogs + p.cogs }
        : { ...p }
    }
    for (const [id, c] of Object.entries(d.byCategory ?? {})) {
      out.byCategory ??= {}
      const cur = out.byCategory[id]
      out.byCategory[id] = cur
        ? { qty: cur.qty + c.qty, sales: cur.sales + c.sales, cogs: cur.cogs + c.cogs }
        : { ...c }
    }
  }
  for (const k of Object.keys(out) as (keyof DailyStatsDelta)[]) {
    if (out[k] === undefined) delete out[k]
  }
  return out
}

/** Fase 7 (R-COM-06): mercancía recibida, a costo real. */
export function purchaseStats(total: Cop): DailyStatsDelta {
  return total > 0 ? { purchases: total } : {}
}

/** Fase 7: pago a un proveedor; si salió de la caja también suma a `supplierPaidCash`. */
export function supplierPaymentStats(amount: Cop, fromCash: boolean): DailyStatsDelta {
  return { supplierPaid: amount, ...(fromCash ? { supplierPaidCash: amount } : {}) }
}

// ---------------------------------------------------------------------------
// Recálculo de un día completo (F6-04, D-221)
// ---------------------------------------------------------------------------

/** Máximo de días por recálculo (cuida las lecturas gratuitas). */
export const MAX_REBUILD_DAYS = 31

export interface RebuildInput {
  orders: readonly { status: string; closedAt: Date | null; lines: readonly StatsLine[] }[]
  payments: readonly { method: StatsMethod; channel: StatsChannel | null; amount: Cop }[]
  movements: readonly { type: string; qty: number; unitCost: Cop }[]
  /** Fase 7: recepciones y pagos a proveedores de la jornada. */
  receptions?: readonly { total: Cop }[]
  supplierPayments?: readonly { amount: Cop; fromCash: boolean }[]
}

/**
 * Estadísticas completas de una jornada a partir de sus cuentas, pagos y movimientos.
 * Debe dar lo mismo que la suma de los deltas que se escribieron en el momento.
 */
export function buildDayStats({
  orders,
  payments,
  movements,
  receptions = [],
  supplierPayments = [],
}: RebuildInput): DailyStatsDelta {
  const deltas: DailyStatsDelta[] = []
  for (const o of orders) {
    if (o.status === 'pagada') deltas.push(paidOrderStats(o.lines, o.closedAt ?? undefined))
    const lost = o.lines.reduce((sum, l) => sum + l.lostQty * l.unitCostSnap, 0)
    if (lost > 0) deltas.push({ orderLosses: lost })
  }
  for (const p of payments) deltas.push(paymentStats(p))
  for (const m of movements) deltas.push(inventoryMovementStats(m.type, m.qty, m.unitCost))
  for (const r of receptions) deltas.push(purchaseStats(r.total))
  for (const p of supplierPayments) deltas.push(supplierPaymentStats(p.amount, p.fromCash))
  return mergeDeltas(...deltas)
}

/** Valida el rango del recálculo: fechas pasadas o de hoy, en orden y de máximo 31 días. */
export function validateRebuildRange(
  from: BusinessDate,
  to: BusinessDate,
  today: BusinessDate,
): string | null {
  if (!from || !to) return 'Escoge las dos fechas.'
  if (to > today) return 'No se puede recalcular días futuros.'
  const span = daysBetween(from, to)
  if (span < 0) return 'La fecha inicial debe ser anterior a la final.'
  if (span + 1 > MAX_REBUILD_DAYS) return `Máximo ${MAX_REBUILD_DAYS} días por vez.`
  return null
}
