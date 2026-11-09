/**
 * Gastos, capital y finanzas — BUSINESS_RULES R-FIN-01…06, F-04…F-20 y D-226.
 * Lógica pura sobre `dailyStats` y los registros de gastos y capital.
 */
import {
  addBusinessMonths,
  daysBetween,
  formatMonth,
  monthRangeOf,
  type BusinessDate,
} from '@/domain/dates'
import type { DailyStatsDelta } from '@/domain/metrics/daily-stats'
import { BP_PER_UNIT, ratioToBp, roundHalfAwayFromZero, type Bp, type Cop } from '@/domain/money'

export class FinanceError extends Error {
  override name = 'FinanceError'
}

// ---------------------------------------------------------------------------
// Gastos (F8-01, F8-02)
// ---------------------------------------------------------------------------

/** R-FIN-05: la inversión (equipamiento) no entra en la utilidad operativa. */
export type ExpenseKind = 'fijo' | 'variable' | 'inversion'

export const EXPENSE_KIND_LABELS: Record<ExpenseKind, string> = {
  fijo: 'Fijo',
  variable: 'Variable',
  inversion: 'Inversión',
}

export interface ExpenseCategory {
  id: string
  name: string
  kind: ExpenseKind
  active: boolean
  sortOrder: number
}

/** Categorías iniciales (D-226 #2), editables. */
export const INITIAL_EXPENSE_CATEGORIES: { id: string; name: string; kind: ExpenseKind }[] = [
  { id: 'arriendo', name: 'Arriendo', kind: 'fijo' },
  { id: 'servicios', name: 'Servicios públicos', kind: 'fijo' },
  { id: 'internet', name: 'Internet', kind: 'fijo' },
  { id: 'nomina', name: 'Nómina', kind: 'fijo' },
  { id: 'licencias', name: 'Licencias', kind: 'fijo' },
  { id: 'transporte', name: 'Transporte', kind: 'variable' },
  { id: 'publicidad', name: 'Publicidad', kind: 'variable' },
  { id: 'mantenimiento', name: 'Mantenimiento', kind: 'variable' },
  { id: 'otros', name: 'Otros', kind: 'variable' },
  { id: 'equipamiento', name: 'Equipamiento', kind: 'inversion' },
]

/** Gasto fijo mensual (D-226 #3): base del recordatorio y del punto de equilibrio. */
export interface FixedExpense {
  id: string
  name: string
  categoryId: string
  amount: Cop
  active: boolean
}

export type PayMethod = 'efectivo' | 'transferencia'

export interface Expense {
  id: string
  categoryId: string
  categoryName: string
  kind: ExpenseKind
  amount: Cop
  businessDate: BusinessDate
  description: string
  method: PayMethod
  fromCash: boolean
  /** Gasto fijo que paga y mes ("2026-11"), para el recordatorio. */
  fixedExpenseId: string | null
  period: string | null
  status: 'activo' | 'anulado'
  voidReason: string | null
  createdAt: Date | null
}

export const MAX_AMOUNT = 100_000_000

export function validateAmount(amount: number | null): string | null {
  if (amount === null || !Number.isSafeInteger(amount) || amount <= 0) return 'Escribe el monto.'
  if (amount > MAX_AMOUNT) return 'El monto es demasiado alto.'
  return null
}

/** Delta de `dailyStats` de un gasto (negativo al anularlo). */
export function expenseStats(kind: ExpenseKind, amount: Cop): DailyStatsDelta {
  if (kind === 'fijo') return { expensesFixed: amount }
  if (kind === 'variable') return { expensesVariable: amount }
  return { investment: amount }
}

/** Mes de una jornada: "2026-11-07" → "2026-11". */
export const periodOf = (date: BusinessDate) => date.slice(0, 7)

/** Gastos fijos activos que aún no se pagan en el mes (D-226 #3). */
export function pendingFixed(
  fixed: readonly FixedExpense[],
  expenses: readonly Pick<Expense, 'fixedExpenseId' | 'period' | 'status'>[],
  period: string,
): FixedExpense[] {
  const paid = new Set(
    expenses
      .filter((e) => e.status === 'activo' && e.period === period && e.fixedExpenseId)
      .map((e) => e.fixedExpenseId),
  )
  return fixed.filter((f) => f.active && !paid.has(f.id))
}

export const fixedMonthlyTotal = (fixed: readonly FixedExpense[]) =>
  fixed.filter((f) => f.active).reduce((s, f) => s + f.amount, 0)

// ---------------------------------------------------------------------------
// Capital (F8-04, R-FIN-02)
// ---------------------------------------------------------------------------

export type CapitalType = 'inversion_inicial' | 'aporte' | 'retiro'

export const CAPITAL_LABELS: Record<CapitalType, string> = {
  inversion_inicial: 'Inversión inicial',
  aporte: 'Aporte del dueño',
  retiro: 'Retiro de ganancias',
}

export interface CapitalEntry {
  id: string
  type: CapitalType
  amount: Cop
  businessDate: BusinessDate
  description: string
  fromCash: boolean
  status: 'activo' | 'anulado'
  voidReason: string | null
  createdAt: Date | null
}

/** Delta de `dailyStats` de un movimiento de capital (negativo al anularlo). */
export function capitalStats(type: CapitalType, amount: Cop): DailyStatsDelta {
  if (type === 'inversion_inicial') return { initialInvestment: amount }
  if (type === 'aporte') return { capitalIn: amount }
  return { ownerWithdrawals: amount }
}

// ---------------------------------------------------------------------------
// Estado de resultados y flujo de caja (F-04…F-13)
// ---------------------------------------------------------------------------

export interface IncomeStatement {
  sales: Cop
  cogs: Cop
  /** F-08 */
  grossProfit: Cop
  grossMarginBp: Bp | null
  /** F-10 neto: pérdidas de inventario y servido no cobrado − sobrantes. */
  losses: Cop
  fixed: Cop
  variable: Cop
  /** F-12 */
  operatingProfit: Cop
  operatingMarginBp: Bp | null
  /** R-FIN-05: equipamiento, fuera de la utilidad. */
  investment: Cop
  /** Compras de mercancía pagadas (D-226 #10): flujo, no utilidad. */
  supplierPaid: Cop
  ordersCount: number
  /** F-20 */
  avgTicket: Cop | null
}

const n = (v: number | undefined) => v ?? 0

export function incomeStatement(t: DailyStatsDelta): IncomeStatement {
  const sales = n(t.salesGross)
  const cogs = n(t.cogs)
  const grossProfit = sales - cogs
  const losses = n(t.orderLosses) + n(t.invLosses) - n(t.invGains)
  const fixed = n(t.expensesFixed)
  const variable = n(t.expensesVariable)
  const operatingProfit = grossProfit - losses - fixed - variable
  const orders = n(t.ordersCount)
  return {
    sales,
    cogs,
    grossProfit,
    grossMarginBp: ratioToBp(grossProfit, sales),
    losses,
    fixed,
    variable,
    operatingProfit,
    operatingMarginBp: ratioToBp(operatingProfit, sales),
    investment: n(t.investment),
    supplierPaid: n(t.supplierPaid),
    ordersCount: orders,
    avgTicket: orders > 0 ? roundHalfAwayFromZero(sales / orders) : null,
  }
}

export interface CashFlow {
  collected: Cop
  capitalIn: Cop
  extraIn: Cop
  inTotal: Cop
  supplierPaid: Cop
  expenses: Cop
  investment: Cop
  withdrawals: Cop
  outTotal: Cop
  /** F-13 */
  net: Cop
}

/**
 * F-13: entra lo cobrado, los aportes y las entradas extraordinarias; sale lo pagado a
 * proveedores, los gastos, la inversión y los retiros. La inversión inicial no cuenta: es plata
 * del dueño que se gastó en el mismo momento en los ítems (D-226 #8).
 */
export function cashFlow(t: DailyStatsDelta): CashFlow {
  const collected = n(t.collected)
  const capitalIn = n(t.capitalIn)
  const extraIn = n(t.cashExtraIn)
  const supplierPaid = n(t.supplierPaid)
  const expenses = n(t.expensesFixed) + n(t.expensesVariable)
  const investment = n(t.investment)
  const withdrawals = n(t.ownerWithdrawals)
  const inTotal = collected + capitalIn + extraIn
  const outTotal = supplierPaid + expenses + investment + withdrawals
  return {
    collected,
    capitalIn,
    extraIn,
    inTotal,
    supplierPaid,
    expenses,
    investment,
    withdrawals,
    outTotal,
    net: inTotal - outTotal,
  }
}

// ---------------------------------------------------------------------------
// Punto de equilibrio (F-16, F-17, D-226 #6)
// ---------------------------------------------------------------------------

export interface BreakEven {
  /** F-16: margen de contribución (ventas − CMV − gastos variables) / ventas. */
  contributionBp: Bp | null
  /** F-17: ventas del mes para cubrir los gastos fijos (null = datos insuficientes). */
  sales: Cop | null
  /** Causa cuando no se puede calcular (R-FIN-06). */
  reason: string | null
}

export function breakEven(fixedMonthly: Cop, t: DailyStatsDelta): BreakEven {
  const sales = n(t.salesGross)
  if (fixedMonthly <= 0) {
    return { contributionBp: null, sales: null, reason: 'Define tus gastos fijos del mes.' }
  }
  if (sales <= 0) {
    return {
      contributionBp: null,
      sales: null,
      reason: 'Aún no hay ventas para calcular el margen.',
    }
  }
  const contribution = sales - n(t.cogs) - n(t.expensesVariable)
  const contributionBp = ratioToBp(contribution, sales)
  if (contributionBp === null || contributionBp <= 0) {
    return {
      contributionBp,
      sales: null,
      reason: 'El margen de las ventas no cubre los gastos variables.',
    }
  }
  return {
    contributionBp,
    sales: Math.ceil((fixedMonthly * BP_PER_UNIT) / contributionBp),
    reason: null,
  }
}

export interface MonthProgress {
  /** 0–10000 bp (puede pasar de 10000). */
  progressBp: number
  missing: Cop
  daysLeft: number
  /** Lo que falta vender por día en lo que queda del mes. */
  perDay: Cop | null
}

/** Avance del mes hacia el punto de equilibrio (D-226 #6). */
export function monthProgress(soldInMonth: Cop, target: Cop, today: BusinessDate): MonthProgress {
  const { to } = monthRangeOf(today)
  const daysLeft = daysBetween(today, to) + 1
  const missing = Math.max(0, target - soldInMonth)
  return {
    progressBp: target > 0 ? Math.round((soldInMonth * BP_PER_UNIT) / target) : 0,
    missing,
    daysLeft,
    perDay: missing > 0 ? Math.ceil(missing / daysLeft) : null,
  }
}

// ---------------------------------------------------------------------------
// Recuperación de la inversión (F-18, F-19, D-226 #7)
// ---------------------------------------------------------------------------

export interface MonthPoint {
  key: string
  label: string
  /** Inversión del mes: inversión inicial + equipamiento. */
  invested: Cop
  operatingProfit: Cop
  /** Lo que falta por recuperar al cierre del mes (positivo = falta). */
  pending: Cop
}

export interface Recovery {
  totalInvested: Cop
  totalProfit: Cop
  /** F-18 (D-226): inversión total − utilidad operativa acumulada. */
  pending: Cop
  recoveredBp: number
  months: MonthPoint[]
  /** Utilidad operativa promedio mensual de hasta los últimos 3 meses. */
  avgMonthlyProfit: Cop | null
  /** F-19: meses estimados; null si no hay utilidad para estimar. */
  monthsLeft: number | null
  /** Menos de 3 meses de datos: estimación poco confiable. */
  lowConfidence: boolean
}

type DayLike = DailyStatsDelta & { businessDate: BusinessDate }

/**
 * Recuperación desde el primer día con datos (D-226 #7): la curva arranca en la inversión y baja
 * con la utilidad. El mes en curso se proyecta al mes completo para el promedio.
 */
export function recovery(days: readonly DayLike[], today: BusinessDate): Recovery {
  const sorted = [...days].sort((a, b) => a.businessDate.localeCompare(b.businessDate))
  const months: MonthPoint[] = []
  if (sorted.length > 0) {
    let pending = 0
    const byMonth = new Map<string, DayLike[]>()
    for (const d of sorted) {
      const k = periodOf(d.businessDate)
      byMonth.set(k, [...(byMonth.get(k) ?? []), d])
    }
    for (
      let m = monthRangeOf(sorted[0]!.businessDate).from;
      m <= today;
      m = addBusinessMonths(m, 1)
    ) {
      const k = periodOf(m)
      const ds = byMonth.get(k) ?? []
      const invested = ds.reduce((s, d) => s + n(d.initialInvestment) + n(d.investment), 0)
      const profit = ds.reduce((s, d) => s + incomeStatement(d).operatingProfit, 0)
      pending += invested - profit
      months.push({ key: k, label: formatMonth(m), invested, operatingProfit: profit, pending })
    }
  }
  const totalInvested = months.reduce((s, m) => s + m.invested, 0)
  const totalProfit = months.reduce((s, m) => s + m.operatingProfit, 0)
  const pending = totalInvested - totalProfit

  // Promedio: hasta 3 meses; el mes en curso se proyecta al mes completo según los días que lleva.
  const recent = months.slice(-3)
  let avgMonthlyProfit: Cop | null = null
  if (recent.length > 0) {
    const current = periodOf(today)
    const scaled = recent.map((m) => {
      if (m.key !== current) return m.operatingProfit
      const { from, to } = monthRangeOf(today)
      const elapsed = daysBetween(from, today) + 1
      const monthDays = daysBetween(from, to) + 1
      return Math.round((m.operatingProfit / elapsed) * monthDays)
    })
    avgMonthlyProfit = Math.round(scaled.reduce((s, v) => s + v, 0) / scaled.length)
  }
  const monthsLeft =
    pending <= 0
      ? 0
      : avgMonthlyProfit !== null && avgMonthlyProfit > 0
        ? Math.ceil(pending / avgMonthlyProfit)
        : null
  return {
    totalInvested,
    totalProfit,
    pending,
    recoveredBp:
      totalInvested > 0
        ? Math.max(
            0,
            Math.min(BP_PER_UNIT, Math.round((totalProfit * BP_PER_UNIT) / totalInvested)),
          )
        : 0,
    months,
    avgMonthlyProfit,
    monthsLeft,
    lowConfidence: months.filter((m) => m.key !== periodOf(today)).length < 3,
  }
}

// ---------------------------------------------------------------------------
// Mercancía: lo invertido, lo vendido y lo que falta por vender (D-227)
// ---------------------------------------------------------------------------

export interface MerchandiseFlow {
  /** Mercancía recibida a costo real desde el inicio (dailyStats.purchases). */
  purchased: Cop
  /** Costo de lo vendido acumulado: ya recuperado al vender. */
  soldCost: Cop
  /** Ventas acumuladas y ganancia obtenida (ventas − costo). */
  soldSales: Cop
  realizedProfit: Cop
  /** Stock actual a costo y a precio de venta (F-14). */
  stockCost: Cop
  stockSale: Cop
  /** Ganancia que queda si se vende todo el stock actual. */
  potentialProfit: Cop
  /** Porcentaje de lo comprado que ya se vendió (bp), null si no hay compras. */
  soldBp: Bp | null
  /**
   * Diferencia: vendido + stock − comprado. Positivo: mercancía que entró sin compra
   * (inventario inicial o sobrantes). Negativo: mercancía que se perdió o se ajustó a la baja.
   */
  otherMoves: Cop
}

/** Flujo de mercancía acumulado desde el inicio, con el stock actual de los productos (D-227). */
export function merchandiseFlow(
  days: readonly DailyStatsDelta[],
  products: readonly { stock: number; avgCost: Cop; salePrice: Cop }[],
): MerchandiseFlow {
  const purchased = days.reduce((sum, d) => sum + n(d.purchases), 0)
  const soldCost = days.reduce((sum, d) => sum + n(d.cogs), 0)
  const soldSales = days.reduce((sum, d) => sum + n(d.salesGross), 0)
  const stockCost = products.reduce((sum, p) => sum + p.stock * p.avgCost, 0)
  const stockSale = products.reduce((sum, p) => sum + p.stock * p.salePrice, 0)
  return {
    purchased,
    soldCost,
    soldSales,
    realizedProfit: soldSales - soldCost,
    stockCost,
    stockSale,
    potentialProfit: stockSale - stockCost,
    soldBp: ratioToBp(soldCost, purchased),
    otherMoves: stockCost + soldCost - purchased,
  }
}
