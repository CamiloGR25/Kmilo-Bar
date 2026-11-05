/**
 * Escribe `dailyStats/{businessDate}` con `increment()` dentro de la transacción de la operación
 * (D-204, D-219). Nunca se lee para escribir: dos cobros simultáneos suman bien.
 */
import {
  doc,
  increment,
  onSnapshot,
  serverTimestamp,
  type Firestore,
  type Transaction,
} from 'firebase/firestore'
import type { DailyStatsDelta } from '@/domain/metrics/daily-stats'
import { db } from '@/lib/firebase/firestore'
import { useSubscription } from '@/lib/firebase/use-subscription'

const incMap = (m: Record<string, number> | undefined) =>
  m ? Object.fromEntries(Object.entries(m).map(([k, v]) => [k, increment(v)])) : undefined

/** Convierte el delta en un documento con incrementos (para `set` con `merge`). */
export function dailyStatsUpdate(businessDate: string, delta: DailyStatsDelta) {
  const data: Record<string, unknown> = { businessDate, updatedAt: serverTimestamp() }
  for (const key of ['salesGross', 'cogs', 'ordersCount', 'collected', 'orderLosses'] as const) {
    const v = delta[key]
    if (v !== undefined && v !== 0) data[key] = increment(v)
  }
  if (delta.byMethod) data.byMethod = incMap(delta.byMethod)
  if (delta.byChannel) data.byChannel = incMap(delta.byChannel)
  if (delta.byProduct) {
    data.byProduct = Object.fromEntries(
      Object.entries(delta.byProduct).map(([id, p]) => [
        id,
        {
          name: p.name,
          categoryId: p.categoryId,
          qty: increment(p.qty),
          sales: increment(p.sales),
          cogs: increment(p.cogs),
        },
      ]),
    )
  }
  if (delta.byCategory) {
    data.byCategory = Object.fromEntries(
      Object.entries(delta.byCategory).map(([id, c]) => [
        id,
        { qty: increment(c.qty), sales: increment(c.sales), cogs: increment(c.cogs) },
      ]),
    )
  }
  return data
}

export function addDailyStats(
  database: Firestore,
  tx: Transaction,
  businessDate: string,
  delta: DailyStatsDelta,
) {
  tx.set(doc(database, 'dailyStats', businessDate), dailyStatsUpdate(businessDate, delta), {
    merge: true,
  })
}

export interface DailyStats {
  businessDate: string
  salesGross: number
  cogs: number
  ordersCount: number
  collected: number
  orderLosses: number
  byMethod: Record<string, number>
  byChannel: Record<string, number>
}

/** Resumen de una jornada en tiempo real (null si aún no hay datos). */
export function useDailyStats(businessDate: string) {
  return useSubscription<DailyStats | null>(
    (onData, onError) =>
      onSnapshot(
        doc(db, 'dailyStats', businessDate),
        (snap) => {
          const x = snap.data()
          onData(
            x
              ? {
                  businessDate,
                  salesGross: Number(x.salesGross ?? 0),
                  cogs: Number(x.cogs ?? 0),
                  ordersCount: Number(x.ordersCount ?? 0),
                  collected: Number(x.collected ?? 0),
                  orderLosses: Number(x.orderLosses ?? 0),
                  byMethod: (x.byMethod ?? {}) as Record<string, number>,
                  byChannel: (x.byChannel ?? {}) as Record<string, number>,
                }
              : null,
          )
        },
        onError,
      ),
    `dailyStats/${businessDate}`,
  )
}
