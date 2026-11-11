/**
 * Carga de datos para los reportes (Fase 9, F9-01). Lecturas puntuales (no en tiempo real):
 * cada reporte se arma una vez por consulta. Lee solo lo del periodo, con rangos de jornada.
 * La conversión de documentos vive en `domain/report-input.ts` (la misma que usa el envío
 * programado de la Fase 10).
 */
import { collection, getDocs, query, where, type QueryConstraint } from 'firebase/firestore'
import type { BusinessDateRange } from '@/domain/dates'
import { db } from '@/lib/firebase/firestore'
import { buildReportInput, type RawDoc, type RawDocs } from '../domain/report-input'
import type { ReportInput } from '../domain/reports'

/** Máximo de jornadas por consulta de reportes (un año). */
export { MAX_REPORT_DAYS } from '../domain/reports'

const inRange = (field: string, range: BusinessDateRange): QueryConstraint[] => [
  where(field, '>=', range.from),
  where(field, '<=', range.to),
]

async function readAll(name: string, constraints: QueryConstraint[] = []): Promise<RawDoc[]> {
  const snap = await getDocs(query(collection(db, name), ...constraints))
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }))
}

/** Lee todo lo que necesita el reporte para el periodo indicado. */
export async function loadReportInput(range: BusinessDateRange): Promise<ReportInput> {
  const [dailyStats, products, categories, inventoryMovements, expenses, receptions] =
    await Promise.all([
      readAll('dailyStats', inRange('businessDate', range)),
      readAll('products'),
      readAll('categories'),
      readAll('inventoryMovements', inRange('businessDate', range)),
      readAll('expenses', inRange('businessDate', range)),
      readAll('receptions', inRange('businessDate', range)),
    ])
  const [supplierPayments, suppliers, cashSessions] = await Promise.all([
    readAll('supplierPayments', inRange('businessDate', range)),
    readAll('suppliers'),
    readAll('cashSessions', inRange('businessDate', range)),
  ])
  const raw: RawDocs = {
    dailyStats,
    products,
    categories,
    inventoryMovements,
    expenses,
    receptions,
    supplierPayments,
    suppliers,
    cashSessions,
  }
  return buildReportInput(range, raw)
}
