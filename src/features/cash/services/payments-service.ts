/**
 * Cobros en Firestore (Fase 5) — R-PAG-01…04, R-VEN-08, D-219.
 * Cada pago es inmutable y se escribe en la misma transacción que la cuenta, la mesa y el
 * resumen diario. El ID se genera al abrir el cobro (D-203): repetirlo no cobra dos veces.
 */
import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { formatCop } from '@/domain/money'
import { correctionStats, paidOrderStats, paymentStats } from '@/domain/metrics/daily-stats'
import { db } from '@/lib/firebase/firestore'
import { toDate, useSubscription } from '@/lib/firebase/use-subscription'
import { addAudit } from '@/features/audit/services/audit'
import { isOpen, orderTitle } from '@/features/orders/domain/orders'
import { orderFromDoc } from '@/features/orders/services/orders-service'
import { addDailyStats } from '@/features/reports/services/daily-stats'
import {
  methodLabel,
  PaymentError,
  planMethodCorrection,
  type Payment,
  type PaymentMethod,
  type PaymentPlan,
  type TransferChannel,
} from '../domain/payments'

export function paymentFromDoc(id: string, x: Record<string, unknown>): Payment {
  const from = x.correctedFrom as { method: PaymentMethod; channel: TransferChannel | null } | null
  return {
    id,
    orderId: String(x.orderId ?? ''),
    cashSessionId: String(x.cashSessionId ?? ''),
    businessDate: String(x.businessDate ?? ''),
    method: x.method === 'transferencia' ? 'transferencia' : 'efectivo',
    channel: (x.channel as TransferChannel | null) ?? null,
    amount: Number(x.amount ?? 0),
    tendered: x.tendered == null ? null : Number(x.tendered),
    change: Number(x.change ?? 0),
    reference: (x.reference as string | null) ?? null,
    createdAt: toDate(x.createdAt),
    correctedFrom: from ?? null,
  }
}

const byCreated = (a: Payment, b: Payment) =>
  (a.createdAt?.getTime() ?? Infinity) - (b.createdAt?.getTime() ?? Infinity)

function usePaymentsWhere(field: 'orderId' | 'cashSessionId', value: string | undefined) {
  return useSubscription<Payment[]>(
    (onData, onError) => {
      if (!value) {
        onData([])
        return () => {}
      }
      return onSnapshot(
        query(collection(db, 'payments'), where(field, '==', value)),
        (snap) => onData(snap.docs.map((d) => paymentFromDoc(d.id, d.data())).sort(byCreated)),
        onError,
      )
    },
    `payments/${field}/${value ?? ''}`,
  )
}

/** Pagos de una cuenta. */
export const usePaymentsOfOrder = (orderId: string | undefined) =>
  usePaymentsWhere('orderId', orderId)

/** Pagos de una caja (para el arqueo). */
export const usePaymentsOfSession = (sessionId: string | undefined) =>
  usePaymentsWhere('cashSessionId', sessionId)

export interface PaymentResult {
  created: boolean
  /** La cuenta quedó pagada (saldo 0). */
  paid: boolean
  balanceAfter: number
}

/**
 * Registra un pago (R-PAG-02). Si el saldo llega a 0, la cuenta queda `pagada`, la mesa se
 * libera y sus ventas se suman al resumen diario (F-04, F-07). Lo cobrado se suma siempre (F-06).
 */
export async function registerPayment(
  uid: string,
  orderId: string,
  paymentId: string,
  plan: PaymentPlan,
): Promise<PaymentResult> {
  return runTransaction(db, async (tx) => {
    const orderRef = doc(db, 'orders', orderId)
    const paymentRef = doc(db, 'payments', paymentId)
    const [paymentSnap, orderSnap, cashSnap] = await Promise.all([
      tx.get(paymentRef),
      tx.get(orderRef),
      tx.get(doc(db, 'counters', 'cashSessions')),
    ])
    if (!orderSnap.exists()) throw new PaymentError('La cuenta no existe.')
    const order = orderFromDoc(orderSnap.id, orderSnap.data())
    if (paymentSnap.exists()) {
      // Doble toque o reintento: ya quedó registrado.
      return { created: false, paid: order.status === 'pagada', balanceAfter: order.balance }
    }
    if (!isOpen(order.status)) throw new PaymentError('La cuenta ya está cerrada.')
    if (cashSnap.data()?.openSessionId !== order.cashSessionId) {
      throw new PaymentError('La caja de esta cuenta no está abierta.')
    }
    if (plan.amount <= 0 || plan.amount > order.balance) {
      throw new PaymentError(`El saldo cambió: ahora es ${formatCop(order.balance)}.`)
    }

    const paidTotal = order.paidTotal + plan.amount
    const balance = order.total - paidTotal
    const paid = balance === 0
    tx.set(paymentRef, {
      orderId,
      cashSessionId: order.cashSessionId,
      businessDate: order.businessDate,
      method: plan.method,
      channel: plan.channel,
      amount: plan.amount,
      tendered: plan.tendered,
      change: plan.change,
      reference: plan.reference,
      kind: 'pago',
      uid,
      createdAt: serverTimestamp(),
      correctedAt: null,
      correctedFrom: null,
    })
    tx.update(orderRef, {
      paidTotal,
      balance,
      lastPaymentId: paymentId,
      // R-VEN-08: solo pasa a pagada con saldo 0 (sin fiado, D-103).
      ...(paid ? { status: 'pagada', closedAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp(),
    })
    if (paid && order.type === 'mesa' && order.tableId) {
      tx.update(doc(db, 'tables', order.tableId), { status: 'disponible', currentOrderId: null })
    }
    const stats = paymentStats(plan)
    addDailyStats(
      db,
      tx,
      order.businessDate,
      paid ? { ...stats, ...paidOrderStats(order.lines) } : stats,
    )
    if (paid) {
      addAudit(db, tx, uid, {
        action: 'cuenta_pagada',
        entity: 'order',
        entityId: orderId,
        summary: `Cuenta #${order.number} (${orderTitle(order)}) pagada: ${formatCop(order.total)}`,
      })
    }
    return { created: true, paid, balanceAfter: balance }
  })
}

/**
 * Corrige el medio de un pago mientras su caja siga abierta (D-219). No cambia el monto ni
 * la cuenta: solo cómo entró el dinero, para que el arqueo cuadre. Queda en la auditoría.
 */
export async function correctPaymentMethod(
  uid: string,
  paymentId: string,
  method: PaymentMethod,
  channel: TransferChannel | null,
) {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'payments', paymentId)
    const [snap, cashSnap] = await Promise.all([
      tx.get(ref),
      tx.get(doc(db, 'counters', 'cashSessions')),
    ])
    if (!snap.exists()) throw new PaymentError('El pago no existe.')
    const payment = paymentFromDoc(snap.id, snap.data())
    if (cashSnap.data()?.openSessionId !== payment.cashSessionId) {
      throw new PaymentError('La caja de este pago ya se cerró.')
    }
    const fix = planMethodCorrection(payment, method, channel)
    tx.update(ref, { ...fix, correctedAt: serverTimestamp() })
    addDailyStats(db, tx, payment.businessDate, correctionStats(payment, fix, payment.amount))
    addAudit(db, tx, uid, {
      action: 'corregir_medio_pago',
      entity: 'cash',
      entityId: paymentId,
      summary: `Pago de ${formatCop(payment.amount)}: ${methodLabel(payment)} → ${methodLabel(fix)}`,
      before: { method: payment.method, channel: payment.channel },
      after: { method: fix.method, channel: fix.channel },
    })
  })
}
