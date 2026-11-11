/**
 * Conversión de documentos de Firestore a los datos del motor de reportes (Fase 9, F9-01).
 * Pura: no usa el SDK del navegador ni el de administración, así que la app y el envío
 * programado (Fase 10) comparten exactamente el mismo criterio.
 */
import type { BusinessDateRange } from '@/domain/dates'
import type { DailyStatsDelta, ProductStats, CategoryStats } from '@/domain/metrics/daily-stats'
import type { ExpenseKind } from '@/features/finance/domain/finance'
import type { ReportInput } from './reports'

/** Documento con su ID y sus campos, sin depender del SDK. */
export interface RawDoc {
  id: string
  data: Record<string, unknown>
}

export interface RawDocs {
  dailyStats: RawDoc[]
  products: RawDoc[]
  categories: RawDoc[]
  inventoryMovements: RawDoc[]
  expenses: RawDoc[]
  receptions: RawDoc[]
  supplierPayments: RawDoc[]
  suppliers: RawDoc[]
  cashSessions: RawDoc[]
}

/** Milisegundos de una marca de tiempo (Timestamp del cliente o del servidor), o 0. */
function millis(v: unknown): number {
  if (v && typeof v === 'object' && 'toDate' in v) {
    const d = (v as { toDate: () => Date }).toDate()
    return d.getTime()
  }
  return 0
}

const num = (v: unknown) => Number(v ?? 0)
const str = (v: unknown) => String(v ?? '')
const map = (v: unknown): Record<string, number> =>
  v && typeof v === 'object' ? (v as Record<string, number>) : {}

function dayFrom(doc: RawDoc): DailyStatsDelta & { businessDate: string } {
  const x = doc.data
  return {
    businessDate: str(x.businessDate || doc.id),
    salesGross: num(x.salesGross),
    cogs: num(x.cogs),
    ordersCount: num(x.ordersCount),
    collected: num(x.collected),
    orderLosses: num(x.orderLosses),
    invLosses: num(x.invLosses),
    invGains: num(x.invGains),
    purchases: num(x.purchases),
    supplierPaid: num(x.supplierPaid),
    supplierPaidCash: num(x.supplierPaidCash),
    expensesFixed: num(x.expensesFixed),
    expensesVariable: num(x.expensesVariable),
    investment: num(x.investment),
    initialInvestment: num(x.initialInvestment),
    capitalIn: num(x.capitalIn),
    ownerWithdrawals: num(x.ownerWithdrawals),
    cashExtraIn: num(x.cashExtraIn),
    byMethod: map(x.byMethod) as DailyStatsDelta['byMethod'],
    byChannel: map(x.byChannel) as DailyStatsDelta['byChannel'],
    byLossType: map(x.byLossType) as DailyStatsDelta['byLossType'],
    byHour: map(x.byHour),
    byProduct: (x.byProduct ?? {}) as Record<string, ProductStats>,
    byCategory: (x.byCategory ?? {}) as Record<string, CategoryStats>,
  }
}

/** Arma los datos del motor de reportes a partir de los documentos leídos de Firestore. */
export function buildReportInput(range: BusinessDateRange, raw: RawDocs): ReportInput {
  const categoryNames = new Map(raw.categories.map((c) => [c.id, str(c.data.name)]))
  const products = raw.products.map((p) => ({
    id: p.id,
    name: str(p.data.name),
    categoryId: str(p.data.categoryId),
    categoryName: categoryNames.get(str(p.data.categoryId)) ?? str(p.data.categoryId),
    stock: num(p.data.stock),
    minStock: num(p.data.minStock),
    avgCost: num(p.data.avgCost),
    salePrice: num(p.data.salePrice),
    active: p.data.active === true,
  }))
  return {
    range,
    days: raw.dailyStats.map(dayFrom),
    products,
    movements: raw.inventoryMovements.map((d) => ({
      businessDate: str(d.data.businessDate),
      productName: str(d.data.productName),
      type: str(d.data.type),
      qty: num(d.data.qty),
      stockBefore: num(d.data.stockBefore),
      stockAfter: num(d.data.stockAfter),
      unitCost: num(d.data.unitCost),
      reason: (d.data.reason as string | null) ?? null,
      createdAtMs: millis(d.data.createdAt),
    })),
    expenses: raw.expenses
      .filter((e) => e.data.status !== 'anulado')
      .map((e) => ({
        businessDate: str(e.data.businessDate),
        categoryName: str(e.data.categoryName),
        kind: (e.data.kind as ExpenseKind) ?? 'variable',
        amount: num(e.data.amount),
        method: (e.data.method as 'efectivo' | 'transferencia') ?? 'efectivo',
        fromCash: e.data.fromCash === true,
        description: str(e.data.description),
      })),
    receptions: raw.receptions.map((r) => ({
      supplierId: str(r.data.supplierId),
      businessDate: str(r.data.businessDate),
      total: num(r.data.total),
    })),
    supplierPayments: raw.supplierPayments.map((p) => ({
      supplierId: str(p.data.supplierId),
      businessDate: str(p.data.businessDate),
      amount: num(p.data.amount),
    })),
    suppliers: raw.suppliers.map((s) => ({ id: s.id, name: str(s.data.name) })),
    sessions: raw.cashSessions.map((s) => {
      const x = s.data
      const summary = (x.summary ?? {}) as Record<string, unknown>
      return {
        businessDate: str(x.businessDate),
        number: num(x.number),
        openingBalance: num(x.openingBalance),
        status: x.status === 'cerrada' ? ('cerrada' as const) : ('abierta' as const),
        sales: num(summary.sales),
        expectedCash: x.expectedCash == null ? null : num(x.expectedCash),
        countedCash: x.countedCash == null ? null : num(x.countedCash),
        difference: x.difference == null ? null : num(x.difference),
        differenceReason: (x.differenceReason as string | null) ?? null,
      }
    }),
  }
}
