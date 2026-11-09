/**
 * Recálculo de `dailyStats` (F6-04, D-221): reconstruye cada jornada desde sus cuentas, pagos y
 * movimientos de inventario y reemplaza el documento. Sirve si algún día no cuadra y para llenar
 * las pérdidas de inventario de días anteriores a la Fase 6.
 */
import { collection, doc, getDocs, query, where, writeBatch } from 'firebase/firestore'
import { eachBusinessDate, type BusinessDate } from '@/domain/dates'
import {
  buildDayStats,
  INVENTORY_LOSS_KEYS,
  type StatsChannel,
  type StatsMethod,
} from '@/domain/metrics/daily-stats'
import { formatCop } from '@/domain/money'
import { db } from '@/lib/firebase/firestore'
import { addAudit } from '@/features/audit/services/audit'
import { orderFromDoc } from '@/features/orders/services/orders-service'
import { dailyStatsDocument } from './daily-stats'

/** Movimientos que afectan las estadísticas (pérdidas y sobrantes). */
const STATS_MOVEMENT_TYPES = [...INVENTORY_LOSS_KEYS, 'ajuste_positivo']

async function rebuildDay(uid: string, date: BusinessDate) {
  const byDate = (col: string) =>
    getDocs(query(collection(db, col), where('businessDate', '==', date)))
  const [orders, payments, receptions, supplierPayments, movements] = await Promise.all([
    byDate('orders'),
    byDate('payments'),
    byDate('receptions'),
    byDate('supplierPayments'),
    getDocs(
      query(
        collection(db, 'inventoryMovements'),
        where('businessDate', '==', date),
        where('type', 'in', STATS_MOVEMENT_TYPES),
      ),
    ),
  ])
  const full = buildDayStats({
    orders: orders.docs.map((d) => orderFromDoc(d.id, d.data())),
    payments: payments.docs.map((d) => ({
      method: d.data().method as StatsMethod,
      channel: (d.data().channel as StatsChannel | null) ?? null,
      amount: Number(d.data().amount ?? 0),
    })),
    receptions: receptions.docs.map((d) => ({ total: Number(d.data().total ?? 0) })),
    supplierPayments: supplierPayments.docs.map((d) => ({
      amount: Number(d.data().amount ?? 0),
      fromCash: d.data().fromCash === true,
    })),
    movements: movements.docs.map((d) => ({
      type: String(d.data().type),
      qty: Number(d.data().qty ?? 0),
      unitCost: Number(d.data().unitCost ?? 0),
    })),
  })
  const batch = writeBatch(db)
  batch.set(doc(db, 'dailyStats', date), dailyStatsDocument(date, full))
  addAudit(db, batch, uid, {
    action: 'recalcular_estadisticas',
    entity: 'stats',
    entityId: date,
    summary: `Estadísticas del ${date} recalculadas: ventas ${formatCop(full.salesGross ?? 0)}, cobrado ${formatCop(full.collected ?? 0)}`,
  })
  await batch.commit()
}

/** Recalcula un rango ya validado, día por día. `onProgress` recibe cuántos van. */
export async function rebuildStats(
  uid: string,
  from: BusinessDate,
  to: BusinessDate,
  onProgress?: (done: number, total: number) => void,
) {
  const dates = eachBusinessDate({ from, to })
  for (const [i, date] of dates.entries()) {
    await rebuildDay(uid, date)
    onProgress?.(i + 1, dates.length)
  }
  return dates.length
}
