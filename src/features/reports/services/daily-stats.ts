/**
 * Escribe `dailyStats/{businessDate}` con `increment()` dentro de la transacción de la operación
 * (D-204, D-219). Nunca se lee para escribir: dos cobros simultáneos suman bien.
 * Lectura en tiempo real de un día o de un rango para Inicio y Ventas (Fase 6, D-221).
 */
import {
  collection,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  type Firestore,
  type Transaction,
} from 'firebase/firestore'
import type { BusinessDate } from '@/domain/dates'
import type {
  CategoryStats,
  DailyStatsDelta,
  InventoryLossKey,
  ProductStats,
} from '@/domain/metrics/daily-stats'
import { db } from '@/lib/firebase/firestore'
import { useSubscription } from '@/lib/firebase/use-subscription'

const NUM_KEYS = [
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

const incMap = (m: Partial<Record<string, number>> | undefined) =>
  m ? Object.fromEntries(Object.entries(m).map(([k, v]) => [k, increment(v ?? 0)])) : undefined

/** Convierte el delta en un documento con incrementos (para `set` con `merge`). */
export function dailyStatsUpdate(businessDate: string, delta: DailyStatsDelta) {
  const data: Record<string, unknown> = { businessDate, updatedAt: serverTimestamp() }
  for (const key of NUM_KEYS) {
    const v = delta[key]
    if (v !== undefined && v !== 0) data[key] = increment(v)
  }
  if (delta.byMethod) data.byMethod = incMap(delta.byMethod)
  if (delta.byChannel) data.byChannel = incMap(delta.byChannel)
  if (delta.byLossType) data.byLossType = incMap(delta.byLossType)
  if (delta.byHour) data.byHour = incMap(delta.byHour)
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

/** Suma el delta al día dentro de la transacción. No escribe nada si el delta está vacío. */
export function addDailyStats(
  database: Firestore,
  tx: Transaction,
  businessDate: string,
  delta: DailyStatsDelta,
) {
  if (Object.keys(delta).length === 0) return
  tx.set(doc(database, 'dailyStats', businessDate), dailyStatsUpdate(businessDate, delta), {
    merge: true,
  })
}

/**
 * Documento completo (sin incrementos) para el recálculo (F6-04): reemplaza el día entero.
 */
export function dailyStatsDocument(businessDate: string, full: DailyStatsDelta) {
  const data: Record<string, unknown> = { businessDate, updatedAt: serverTimestamp() }
  for (const key of NUM_KEYS) data[key] = full[key] ?? 0
  data.byMethod = full.byMethod ?? {}
  data.byChannel = full.byChannel ?? {}
  data.byLossType = full.byLossType ?? {}
  data.byHour = full.byHour ?? {}
  data.byProduct = full.byProduct ?? {}
  data.byCategory = full.byCategory ?? {}
  return data
}

export interface DailyStats {
  businessDate: BusinessDate
  salesGross: number
  cogs: number
  ordersCount: number
  collected: number
  orderLosses: number
  invLosses: number
  invGains: number
  purchases: number
  supplierPaid: number
  supplierPaidCash: number
  byMethod: Record<string, number>
  byChannel: Record<string, number>
  byLossType: Partial<Record<InventoryLossKey, number>>
  byHour: Record<string, number>
  byProduct: Record<string, ProductStats>
  byCategory: Record<string, CategoryStats>
}

const numMap = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, number>) : {})

export function dailyStatsFromDoc(businessDate: string, x: Record<string, unknown>): DailyStats {
  return {
    businessDate,
    salesGross: Number(x.salesGross ?? 0),
    cogs: Number(x.cogs ?? 0),
    ordersCount: Number(x.ordersCount ?? 0),
    collected: Number(x.collected ?? 0),
    orderLosses: Number(x.orderLosses ?? 0),
    invLosses: Number(x.invLosses ?? 0),
    invGains: Number(x.invGains ?? 0),
    purchases: Number(x.purchases ?? 0),
    supplierPaid: Number(x.supplierPaid ?? 0),
    supplierPaidCash: Number(x.supplierPaidCash ?? 0),
    byMethod: numMap(x.byMethod),
    byChannel: numMap(x.byChannel),
    byLossType: numMap(x.byLossType),
    byHour: numMap(x.byHour),
    byProduct: (x.byProduct ?? {}) as Record<string, ProductStats>,
    byCategory: (x.byCategory ?? {}) as Record<string, CategoryStats>,
  }
}

/** Resumen de una jornada en tiempo real (null si aún no hay datos). */
export function useDailyStats(businessDate: string) {
  return useSubscription<DailyStats | null>(
    (onData, onError) =>
      onSnapshot(
        doc(db, 'dailyStats', businessDate),
        (snap) => {
          const x = snap.data()
          onData(x ? dailyStatsFromDoc(businessDate, x) : null)
        },
        onError,
      ),
    `dailyStats/${businessDate}`,
  )
}

/**
 * Días con datos en un rango inclusivo (una lectura por día con datos). Los días sin ventas no
 * tienen documento: las gráficas los completan con ceros.
 */
export function useDailyStatsRange(from: BusinessDate, to: BusinessDate) {
  return useSubscription<DailyStats[]>(
    (onData, onError) =>
      onSnapshot(
        query(
          collection(db, 'dailyStats'),
          where('businessDate', '>=', from),
          where('businessDate', '<=', to),
          orderBy('businessDate'),
        ),
        (snap) => onData(snap.docs.map((d) => dailyStatsFromDoc(d.id, d.data()))),
        onError,
      ),
    `dailyStats/${from}/${to}`,
  )
}
