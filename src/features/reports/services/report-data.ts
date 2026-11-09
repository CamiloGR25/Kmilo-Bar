/**
 * Carga de datos para los reportes (Fase 9, F9-01). Lecturas puntuales (no en tiempo real):
 * cada reporte se arma una vez por consulta. Lee solo lo del periodo, con rangos de jornada.
 */
import { collection, getDocs, query, where } from 'firebase/firestore'
import type { BusinessDateRange } from '@/domain/dates'
import { db } from '@/lib/firebase/firestore'
import { toDate } from '@/lib/firebase/use-subscription'
import { productFromDoc } from '@/features/products/services/catalog-service'
import { expenseFromDoc } from '@/features/finance/services/finance-service'
import { supplierFromDoc } from '@/features/purchases/services/purchases-service'
import { dailyStatsFromDoc } from './daily-stats'
import type { ReportInput } from '../domain/reports'
export { MAX_REPORT_DAYS } from '../domain/reports'

const inRange = (field: string, range: BusinessDateRange) => [
  where(field, '>=', range.from),
  where(field, '<=', range.to),
]

/** Lee todo lo que necesita el reporte para el periodo indicado. */
export async function loadReportInput(range: BusinessDateRange): Promise<ReportInput> {
  const [daysSnap, productsSnap, categoriesSnap, movementsSnap, expensesSnap, receptionsSnap] =
    await Promise.all([
      getDocs(query(collection(db, 'dailyStats'), ...inRange('businessDate', range))),
      getDocs(collection(db, 'products')),
      getDocs(collection(db, 'categories')),
      getDocs(query(collection(db, 'inventoryMovements'), ...inRange('businessDate', range))),
      getDocs(query(collection(db, 'expenses'), ...inRange('businessDate', range))),
      getDocs(query(collection(db, 'receptions'), ...inRange('businessDate', range))),
    ])
  const [paymentsSnap, suppliersSnap, sessionsSnap] = await Promise.all([
    getDocs(query(collection(db, 'supplierPayments'), ...inRange('businessDate', range))),
    getDocs(collection(db, 'suppliers')),
    getDocs(query(collection(db, 'cashSessions'), ...inRange('businessDate', range))),
  ])

  const categoryNames = new Map(categoriesSnap.docs.map((d) => [d.id, String(d.data().name ?? '')]))
  const products = productsSnap.docs.map((d) => {
    const p = productFromDoc(d.id, d.data())
    return {
      id: p.id,
      name: p.name,
      categoryId: p.categoryId,
      categoryName: categoryNames.get(p.categoryId) ?? p.categoryId,
      stock: p.stock,
      minStock: p.minStock,
      avgCost: p.avgCost,
      salePrice: p.salePrice,
      active: p.active,
    }
  })

  return {
    range,
    days: daysSnap.docs.map((d) => {
      const s = dailyStatsFromDoc(d.id, d.data())
      return { ...s }
    }),
    products,
    movements: movementsSnap.docs.map((d) => {
      const x = d.data()
      return {
        businessDate: String(x.businessDate ?? ''),
        productName: String(x.productName ?? ''),
        type: String(x.type ?? ''),
        qty: Number(x.qty ?? 0),
        stockBefore: Number(x.stockBefore ?? 0),
        stockAfter: Number(x.stockAfter ?? 0),
        unitCost: Number(x.unitCost ?? 0),
        reason: (x.reason as string | null) ?? null,
        createdAtMs: toDate(x.createdAt)?.getTime() ?? 0,
      }
    }),
    expenses: expensesSnap.docs
      .map((d) => expenseFromDoc(d.id, d.data()))
      .filter((e) => e.status === 'activo')
      .map((e) => ({
        businessDate: e.businessDate,
        categoryName: e.categoryName,
        kind: e.kind,
        amount: e.amount,
        method: e.method,
        fromCash: e.fromCash,
        description: e.description,
      })),
    receptions: receptionsSnap.docs.map((d) => {
      const x = d.data()
      return {
        supplierId: String(x.supplierId ?? ''),
        businessDate: String(x.businessDate ?? ''),
        total: Number(x.total ?? 0),
      }
    }),
    supplierPayments: paymentsSnap.docs.map((d) => {
      const x = d.data()
      return {
        supplierId: String(x.supplierId ?? ''),
        businessDate: String(x.businessDate ?? ''),
        amount: Number(x.amount ?? 0),
      }
    }),
    suppliers: suppliersSnap.docs.map((d) => {
      const s = supplierFromDoc(d.id, d.data())
      return { id: s.id, name: s.name }
    }),
    sessions: sessionsSnap.docs.map((d) => {
      const x = d.data()
      const summary = (x.summary ?? {}) as Record<string, unknown>
      return {
        businessDate: String(x.businessDate ?? ''),
        number: Number(x.number ?? 0),
        openingBalance: Number(x.openingBalance ?? 0),
        status: x.status === 'cerrada' ? ('cerrada' as const) : ('abierta' as const),
        sales: Number(summary.sales ?? 0),
        expectedCash: x.expectedCash == null ? null : Number(x.expectedCash),
        countedCash: x.countedCash == null ? null : Number(x.countedCash),
        difference: x.difference == null ? null : Number(x.difference),
        differenceReason: (x.differenceReason as string | null) ?? null,
      }
    }),
  }
}
