/**
 * Semáforo, recomendaciones y valor de inventario — BUSINESS_RULES R-INV-06…08, F-14.
 */
import { BP_PER_UNIT, type Bp, type Cop } from '@/domain/money'

export type StockLevel = 'ok' | 'cerca' | 'minimo' | 'agotado'

/**
 * R-INV-06: Agotado (0) · En mínimo (≤ mínimo) · Cerca (≤ mínimo × factor) · OK.
 * Un producto sin mínimo (0) solo puede estar OK o agotado.
 */
export function stockLevel(stock: number, minStock: number, nearMinFactorBp: Bp): StockLevel {
  if (stock <= 0) return 'agotado'
  if (minStock <= 0) return 'ok'
  if (stock <= minStock) return 'minimo'
  if (stock * BP_PER_UNIT <= minStock * nearMinFactorBp) return 'cerca'
  return 'ok'
}

/** Orden de urgencia para listar (agotado primero). */
export const LEVEL_ORDER: Record<StockLevel, number> = { agotado: 0, minimo: 1, cerca: 2, ok: 3 }

/** Los niveles que generan alerta (R-INV-09). */
export function isAlert(level: StockLevel): boolean {
  return level === 'agotado' || level === 'minimo'
}

/**
 * R-INV-08: cantidad sugerida a pedir para volver al stock objetivo (mínimo × factor),
 * descontando lo que ya está pedido. Se redondea hacia arriba a la unidad de compra.
 */
export function recommendedOrderQty(
  stock: number,
  minStock: number,
  targetStockFactorBp: Bp,
  pendingQty = 0,
  unitsPerPurchaseUnit = 1,
): number {
  if (minStock <= 0) return 0
  const target = Math.ceil((minStock * targetStockFactorBp) / BP_PER_UNIT)
  const missing = Math.max(0, target - stock - pendingQty)
  if (missing === 0) return 0
  const pack = Math.max(1, unitsPerPurchaseUnit)
  return Math.ceil(missing / pack) * pack
}

/** Jornadas con ventas necesarias para sugerir un mínimo (R-INV-07). */
export const MIN_DAYS_FOR_SUGGESTION = 14

/**
 * R-INV-07: mínimo sugerido = ⌈venta promedio diaria × (días de entrega + días de seguridad)⌉.
 * Devuelve null si no hay suficientes jornadas con ventas.
 */
export function suggestedMinStock(
  unitsSold: number,
  daysOperated: number,
  daysWithSales: number,
  supplierLeadDays: number,
  safetyDays: number,
): number | null {
  if (daysWithSales < MIN_DAYS_FOR_SUGGESTION || daysOperated <= 0) return null
  const avgDaily = unitsSold / daysOperated
  return Math.ceil(avgDaily * (supplierLeadDays + safetyDays))
}

/** F-14: valor del inventario = Σ stock × costo promedio. */
export function inventoryValue(items: { stock: number; avgCost: Cop }[]): Cop {
  return items.reduce((acc, p) => acc + p.stock * p.avgCost, 0)
}
