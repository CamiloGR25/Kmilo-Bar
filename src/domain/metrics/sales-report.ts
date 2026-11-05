/**
 * Análisis de ventas sobre `dailyStats` (Fase 6, D-221): periodos, comparación, series para las
 * gráficas y tabla por producto. F-04 ventas, F-07 costo de lo vendido, F-08 ganancia y margen,
 * F-10 pérdidas. Lógica pura.
 */
import {
  addBusinessDays,
  addBusinessMonths,
  daysBetween,
  eachBusinessDate,
  formatBusinessDate,
  formatHour,
  formatMonth,
  monthRangeOf,
  weekRangeOf,
  type BusinessDate,
  type BusinessDateRange,
} from '@/domain/dates'
import { ratioToBp, type Bp, type Cop } from '@/domain/money'
import { BUSINESS_DAY_CUTOFF_HOUR } from '@/config/constants'
import {
  mergeDeltas,
  type CategoryStats,
  type DailyStatsDelta,
  type InventoryLossKey,
  type ProductStats,
} from './daily-stats'

export type PeriodKind = 'dia' | 'semana' | 'mes' | 'anio' | 'rango'

export const PERIOD_LABELS: Record<PeriodKind, string> = {
  dia: 'Día',
  semana: 'Semana',
  mes: 'Mes',
  anio: '12 meses',
  rango: 'Rango',
}

/** Día con datos: lo que guarda `dailyStats/{businessDate}`. */
export type DayStats = DailyStatsDelta & { businessDate: BusinessDate }

/** Rango del periodo que contiene `anchor` (en "12 meses", los 12 meses que terminan en él). */
export function periodRange(kind: Exclude<PeriodKind, 'rango'>, anchor: BusinessDate) {
  switch (kind) {
    case 'dia':
      return { from: anchor, to: anchor }
    case 'semana':
      return weekRangeOf(anchor)
    case 'mes':
      return monthRangeOf(anchor)
    case 'anio':
      return {
        from: monthRangeOf(addBusinessMonths(anchor, -11)).from,
        to: monthRangeOf(anchor).to,
      }
  }
}

/** Mueve el ancla al periodo anterior (−1) o siguiente (+1). */
export function shiftAnchor(
  kind: Exclude<PeriodKind, 'rango'>,
  anchor: BusinessDate,
  dir: -1 | 1,
): BusinessDate {
  if (kind === 'dia') return addBusinessDays(anchor, dir)
  if (kind === 'semana') return addBusinessDays(anchor, 7 * dir)
  if (kind === 'mes') return addBusinessMonths(anchor, dir)
  return addBusinessMonths(anchor, 12 * dir)
}

/**
 * Periodo con el que se compara (D-221): un día contra el mismo día de la semana anterior, la
 * semana contra la anterior, el mes contra el anterior, 12 meses contra los 12 anteriores y un
 * rango contra los mismos días justo antes.
 */
export function comparisonRange(kind: PeriodKind, range: BusinessDateRange): BusinessDateRange {
  switch (kind) {
    case 'dia':
    case 'semana':
      return { from: addBusinessDays(range.from, -7), to: addBusinessDays(range.to, -7) }
    case 'mes':
      return monthRangeOf(addBusinessDays(range.from, -1))
    case 'anio':
      return {
        from: addBusinessMonths(range.from, -12),
        to: monthRangeOf(addBusinessDays(range.from, -1)).to,
      }
    case 'rango': {
      const days = daysBetween(range.from, range.to) + 1
      return { from: addBusinessDays(range.from, -days), to: addBusinessDays(range.from, -1) }
    }
  }
}

/** Frase de la comparación: "el viernes anterior", "la semana anterior"… */
export function comparisonLabel(kind: PeriodKind, range: BusinessDateRange): string {
  switch (kind) {
    case 'dia':
      return `el ${formatBusinessDate(addBusinessDays(range.from, -7))}`
    case 'semana':
      return 'la semana anterior'
    case 'mes':
      return 'el mes anterior'
    case 'anio':
      return 'los 12 meses anteriores'
    case 'rango':
      return 'los mismos días antes'
  }
}

export interface SalesTotals {
  salesGross: Cop
  cogs: Cop
  /** F-08: ventas − costo de lo vendido. */
  grossProfit: Cop
  marginBp: Bp | null
  ordersCount: number
  /** Ticket promedio por cuenta pagada. */
  avgTicket: Cop | null
  collected: Cop
  byMethod: Partial<Record<string, Cop>>
  byChannel: Partial<Record<string, Cop>>
  orderLosses: Cop
  invLosses: Cop
  invGains: Cop
  /** F-10: servido no cobrado + salidas de inventario sin venta (sin restar sobrantes). */
  losses: Cop
  byLossType: Partial<Record<InventoryLossKey, Cop>>
  byHour: Record<string, Cop>
  byProduct: Record<string, ProductStats>
  byCategory: Record<string, CategoryStats>
}

/** Suma los días de un periodo. */
export function aggregate(days: readonly DailyStatsDelta[]): SalesTotals {
  const t = mergeDeltas(...days)
  const salesGross = t.salesGross ?? 0
  const cogs = t.cogs ?? 0
  const ordersCount = t.ordersCount ?? 0
  const orderLosses = t.orderLosses ?? 0
  const invLosses = t.invLosses ?? 0
  return {
    salesGross,
    cogs,
    grossProfit: salesGross - cogs,
    marginBp: ratioToBp(salesGross - cogs, salesGross),
    ordersCount,
    avgTicket: ordersCount > 0 ? Math.round(salesGross / ordersCount) : null,
    collected: t.collected ?? 0,
    byMethod: t.byMethod ?? {},
    byChannel: t.byChannel ?? {},
    orderLosses,
    invLosses,
    invGains: t.invGains ?? 0,
    losses: orderLosses + invLosses,
    byLossType: t.byLossType ?? {},
    byHour: t.byHour ?? {},
    byProduct: t.byProduct ?? {},
    byCategory: t.byCategory ?? {},
  }
}

/** Variación en bp frente al periodo anterior (null si antes no hubo ventas). */
export function changeBp(current: number, previous: number): Bp | null {
  if (previous <= 0) return null
  return ratioToBp(current - previous, previous)
}

export interface SeriesPoint {
  key: string
  label: string
  sales: Cop
  profit: Cop
}

const byDate = (days: readonly DayStats[]) => new Map(days.map((d) => [d.businessDate, d]))

/** Una barra por día del rango (los días sin ventas van en cero). */
export function dailySeries(days: readonly DayStats[], range: BusinessDateRange): SeriesPoint[] {
  const map = byDate(days)
  return eachBusinessDate(range).map((date) => {
    const d = map.get(date)
    const sales = d?.salesGross ?? 0
    return { key: date, label: formatBusinessDate(date), sales, profit: sales - (d?.cogs ?? 0) }
  })
}

/** Una barra por mes del rango. */
export function monthlySeries(days: readonly DayStats[], range: BusinessDateRange): SeriesPoint[] {
  const points = new Map<string, SeriesPoint>()
  for (let m = monthRangeOf(range.from).from; m <= range.to; m = addBusinessMonths(m, 1)) {
    const key = m.slice(0, 7)
    points.set(key, { key, label: formatMonth(m), sales: 0, profit: 0 })
  }
  for (const d of days) {
    const p = points.get(d.businessDate.slice(0, 7))
    if (!p) continue
    p.sales += d.salesGross ?? 0
    p.profit += (d.salesGross ?? 0) - (d.cogs ?? 0)
  }
  return [...points.values()]
}

/**
 * Ventas por hora en el orden de la jornada (de las 6 a. m. a las 5 a. m.), recortadas a las
 * horas con ventas para que la gráfica muestre la noche y no el día vacío.
 */
export function hourSeries(
  byHour: Record<string, Cop>,
): { hour: number; label: string; sales: Cop }[] {
  const order = Array.from({ length: 24 }, (_, i) => (BUSINESS_DAY_CUTOFF_HOUR + i) % 24)
  const all = order.map((hour) => ({ hour, label: formatHour(hour), sales: byHour[hour] ?? 0 }))
  const first = all.findIndex((p) => p.sales > 0)
  if (first < 0) return []
  const last = all.findLastIndex((p) => p.sales > 0)
  return all.slice(first, last + 1)
}

export interface ProductRow {
  id: string
  name: string
  categoryId: string
  qty: number
  sales: Cop
  cogs: Cop
  profit: Cop
  marginBp: Bp | null
}

export type ProductSortKey = 'name' | 'qty' | 'sales' | 'profit' | 'marginBp'

export function productRows(byProduct: Record<string, ProductStats>): ProductRow[] {
  return Object.entries(byProduct)
    .filter(([, p]) => p.qty > 0)
    .map(([id, p]) => ({
      id,
      name: p.name,
      categoryId: p.categoryId,
      qty: p.qty,
      sales: p.sales,
      cogs: p.cogs,
      profit: p.sales - p.cogs,
      marginBp: ratioToBp(p.sales - p.cogs, p.sales),
    }))
}

/** Ordena la tabla; los números de mayor a menor por defecto, el nombre de A a Z. */
export function sortRows(rows: readonly ProductRow[], key: ProductSortKey, desc = key !== 'name') {
  const sorted = [...rows].sort((a, b) => {
    if (key === 'name') return a.name.localeCompare(b.name, 'es')
    return (a[key] ?? -Infinity) - (b[key] ?? -Infinity) || a.name.localeCompare(b.name, 'es')
  })
  return desc ? sorted.reverse() : sorted
}

/** Top N por cantidad o por ganancia. */
export function topRows(rows: readonly ProductRow[], key: 'qty' | 'profit', n = 10) {
  return [...rows].sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name, 'es')).slice(0, n)
}

export interface CategoryRow {
  id: string
  qty: number
  sales: Cop
  profit: Cop
}

/** Categorías de mayor a menor venta. */
export function categoryRows(byCategory: Record<string, CategoryStats>): CategoryRow[] {
  return Object.entries(byCategory)
    .filter(([, c]) => c.qty > 0)
    .map(([id, c]) => ({ id, qty: c.qty, sales: c.sales, profit: c.sales - c.cogs }))
    .sort((a, b) => b.sales - a.sales)
}
