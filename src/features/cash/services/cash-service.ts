/**
 * Caja en Firestore: apertura (Fase 4, D-217), movimientos y cierre con arqueo (Fase 5).
 * `counters/cashSessions.openSessionId` apunta a la única caja abierta (R-PAG-07).
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type QuerySnapshot,
} from 'firebase/firestore'
import { businessDateOf } from '@/domain/dates'
import { formatCop } from '@/domain/money'
import { db } from '@/lib/firebase/firestore'
import { toDate, useSubscription } from '@/lib/firebase/use-subscription'
import { addAudit } from '@/features/audit/services/audit'
import { addDailyStats } from '@/features/reports/services/daily-stats'
import { isOpen, type OrderStatus } from '@/features/orders/domain/orders'
import {
  CashError,
  validateOpeningBalance,
  type CashClosing,
  type CashSession,
  type CashSummary,
} from '../domain/cash'
import {
  CASH_MOVEMENT_LABELS,
  expectedCash,
  PaymentError,
  sessionTotals,
  validateClosing,
  type CashMovement,
  type CashMovementType,
} from '../domain/payments'
import { paymentFromDoc } from './payments-service'

const countersRef = () => doc(db, 'counters', 'cashSessions')

function sessionFromDoc(id: string, x: Record<string, unknown>): CashSession {
  return {
    id,
    number: Number(x.number ?? 0),
    businessDate: String(x.businessDate ?? ''),
    status: x.status === 'cerrada' ? 'cerrada' : 'abierta',
    openingBalance: Number(x.openingBalance ?? 0),
    openedAt: toDate(x.openedAt),
    closedAt: toDate(x.closedAt),
    closing:
      x.status === 'cerrada'
        ? {
            expectedCash: Number(x.expectedCash ?? 0),
            countedCash: Number(x.countedCash ?? 0),
            difference: Number(x.difference ?? 0),
            differenceReason: (x.differenceReason as string | null) ?? null,
            summary: x.summary as CashSummary,
          }
        : null,
  }
}

function movementFromDoc(id: string, x: Record<string, unknown>): CashMovement {
  return {
    id,
    sessionId: String(x.sessionId ?? ''),
    type: (x.type as CashMovementType) ?? 'correccion',
    amount: Number(x.amount ?? 0),
    reason: String(x.reason ?? ''),
    createdAt: toDate(x.createdAt),
  }
}

/** Entradas y salidas de una caja. */
export function useCashMovements(sessionId: string | undefined) {
  return useSubscription<CashMovement[]>(
    (onData, onError) => {
      if (!sessionId) {
        onData([])
        return () => {}
      }
      return onSnapshot(
        query(collection(db, 'cashMovements'), where('sessionId', '==', sessionId)),
        (snap) =>
          onData(
            snap.docs
              .map((d) => movementFromDoc(d.id, d.data()))
              .sort(
                (a, b) =>
                  (a.createdAt?.getTime() ?? Infinity) - (b.createdAt?.getTime() ?? Infinity),
              ),
          ),
        onError,
      )
    },
    `cashMovements/${sessionId ?? ''}`,
  )
}

/** Caja abierta en tiempo real (null si no hay ninguna). */
export function useOpenCashSession() {
  return useSubscription<CashSession | null>(
    (onData, onError) =>
      onSnapshot(
        query(collection(db, 'cashSessions'), where('status', '==', 'abierta'), limit(1)),
        (snap) => {
          const d = snap.docs[0]
          onData(d ? sessionFromDoc(d.id, d.data()) : null)
        },
        onError,
      ),
    'cashSessions/open',
  )
}

/** Últimas cajas (la más reciente primero). */
export function useRecentCashSessions(max = 10) {
  return useSubscription<CashSession[]>(
    (onData, onError) =>
      onSnapshot(
        query(collection(db, 'cashSessions'), orderBy('number', 'desc'), limit(max)),
        (snap) => onData(snap.docs.map((d) => sessionFromDoc(d.id, d.data()))),
        onError,
      ),
    `cashSessions/recent/${max}`,
  )
}

/**
 * Abre la caja con su saldo inicial. `sessionId` se genera al abrir el formulario (D-203):
 * si se repite y esa caja ya quedó abierta, no hace nada.
 */
export async function openCashSession(
  uid: string,
  sessionId: string,
  openingBalance: number,
): Promise<boolean> {
  const error = validateOpeningBalance(openingBalance)
  if (error) throw new CashError(error)
  return runTransaction(db, async (tx) => {
    const [counters, review] = await Promise.all([
      tx.get(countersRef()),
      tx.get(doc(db, 'counters', 'inventoryReview')),
    ])
    if (!counters.exists()) throw new CashError('Aún no se preparan los datos de ventas.')
    // R-INV-11: mientras se cuenta el inventario no se vende.
    if (review.data()?.inProgressId) {
      throw new CashError('Hay una revisión de inventario en curso. Termínala o cancélala.')
    }
    const openId = counters.data().openSessionId as string | null
    if (openId === sessionId) return false
    if (openId) throw new CashError('Ya hay una caja abierta.')

    const number = Number(counters.data().last ?? 0) + 1
    const businessDate = businessDateOf(new Date())
    tx.update(countersRef(), { last: number, openSessionId: sessionId })
    tx.set(doc(db, 'cashSessions', sessionId), {
      number,
      businessDate,
      status: 'abierta',
      openingBalance,
      openedAt: serverTimestamp(),
      openedBy: uid,
      closedAt: null,
    })
    addAudit(db, tx, uid, {
      action: 'abrir_caja',
      entity: 'cash',
      entityId: sessionId,
      summary: `Caja #${number} abierta con ${formatCop(openingBalance)}`,
      after: { openingBalance },
    })
    return true
  })
}

/**
 * Entrada o salida de efectivo con motivo (R-PAG-05). Inmutable; el ID se genera al abrir el
 * formulario (D-203). `amount` ya trae el signo (planCashMovement).
 */
export async function registerCashMovement(
  uid: string,
  movementId: string,
  session: Pick<CashSession, 'id' | 'businessDate'>,
  type: CashMovementType,
  amount: number,
  reason: string,
) {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'cashMovements', movementId)
    const [snap, counters] = await Promise.all([tx.get(ref), tx.get(countersRef())])
    if (snap.exists()) return
    if (counters.data()?.openSessionId !== session.id) {
      throw new PaymentError('Esta caja ya no está abierta.')
    }
    tx.set(ref, {
      sessionId: session.id,
      businessDate: session.businessDate,
      type,
      amount,
      reason: reason.trim(),
      refType: null,
      refId: null,
      uid,
      createdAt: serverTimestamp(),
    })
    // F-13: la entrada extraordinaria suma al flujo de caja del día (D-226).
    if (type === 'entrada_extra')
      addDailyStats(db, tx, session.businessDate, { cashExtraIn: amount })
    addAudit(db, tx, uid, {
      action: 'movimiento_caja',
      entity: 'cash',
      entityId: movementId,
      summary: `${CASH_MOVEMENT_LABELS[type]}: ${amount > 0 ? '+' : '−'}${formatCop(Math.abs(amount))}`,
      reason: reason.trim(),
    })
  })
}

/** Cuentas, pagos y movimientos de una caja, tal como están en el momento de leerlos. */
interface SessionRecords {
  orders: QuerySnapshot
  payments: QuerySnapshot
  movements: QuerySnapshot
}

/** Arma el arqueo (esperado, cuentas abiertas y resumen) a partir de los registros de la caja. */
function buildClosingData(session: CashSession, records: SessionRecords) {
  const statuses = records.orders.docs.map((d) => ({
    status: d.data().status as OrderStatus,
    total: Number(d.data().total ?? 0),
  }))
  const totals = sessionTotals(
    records.payments.docs.map((d) => paymentFromDoc(d.id, d.data())),
    records.movements.docs.map((d) => movementFromDoc(d.id, d.data())),
  )
  const paidOrders = statuses.filter((o) => o.status === 'pagada')
  const summary: CashSummary = {
    sales: paidOrders.reduce((s, o) => s + o.total, 0),
    ordersPaid: paidOrders.length,
    ordersNoConsumption: statuses.filter((o) => o.status === 'cerrada_sin_consumo').length,
    ...totals,
  }
  return {
    openOrders: statuses.filter((o) => isOpen(o.status)).length,
    expected: expectedCash(session.openingBalance, totals),
    summary,
  }
}

/** Datos para mostrar el arqueo antes de cerrar (solo lectura). */
export async function loadClosingData(session: CashSession) {
  const records = await readSessionRecords(session.id)
  return buildClosingData(session, records)
}

function readSessionRecords(sessionId: string): Promise<SessionRecords> {
  return Promise.all([
    getDocs(query(collection(db, 'orders'), where('cashSessionId', '==', sessionId))),
    getDocs(query(collection(db, 'payments'), where('cashSessionId', '==', sessionId))),
    getDocs(query(collection(db, 'cashMovements'), where('sessionId', '==', sessionId))),
  ]).then(([orders, payments, movements]) => ({ orders, payments, movements }))
}

/**
 * Cierra la caja (R-PAG-06): conteo físico, diferencia con motivo si no cuadra y resumen.
 * Definitivo: después no se cobra ni se corrige en ella.
 */
export async function closeCashSession(
  uid: string,
  session: CashSession,
  countedCash: number,
  reason: string,
): Promise<CashClosing> {
  // 1) Se lee el arqueo. 2) Dentro de la transacción se comprueba que no hayan cambiado las
  // cuentas (contador de cuentas y su estado, saldo y total) ni la caja. Si cambió algo, no se
  // cierra y el usuario lo vuelve a intentar con el arqueo nuevo.
  const records = await readSessionRecords(session.id)
  const data = buildClosingData(session, records)
  const error = validateClosing(countedCash, data.expected, reason, data.openOrders)
  if (error) throw new CashError(error)
  const difference = countedCash - data.expected
  const closing: CashClosing = {
    expectedCash: data.expected,
    countedCash,
    difference,
    differenceReason: difference === 0 ? null : reason.trim(),
    summary: data.summary,
  }
  const fingerprint = new Map(
    records.orders.docs.map((d) => [
      d.id,
      [d.data().status, Number(d.data().total ?? 0), Number(d.data().paidTotal ?? 0)].join('|'),
    ]),
  )
  const ordersCounterRef = doc(db, 'counters', 'orders')
  const ordersCounterBefore = await getDoc(ordersCounterRef)
  const lastBefore = Number(ordersCounterBefore.data()?.last ?? 0)

  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'cashSessions', session.id)
    const [snap, counters, ordersCounter, orderSnaps] = await Promise.all([
      tx.get(ref),
      tx.get(countersRef()),
      tx.get(ordersCounterRef),
      Promise.all([...fingerprint.keys()].map((id) => tx.get(doc(db, 'orders', id)))),
    ])
    if (!snap.exists() || snap.data().status !== 'abierta') {
      throw new CashError('Esta caja ya está cerrada.')
    }
    if (counters.data()?.openSessionId !== session.id) {
      throw new CashError('Esta caja no es la abierta.')
    }
    const changed =
      Number(ordersCounter.data()?.last ?? 0) !== lastBefore ||
      orderSnaps.some((o) => {
        const x = o.data()
        return (
          fingerprint.get(o.id) !==
          [x?.status, Number(x?.total ?? 0), Number(x?.paidTotal ?? 0)].join('|')
        )
      })
    if (changed) {
      throw new CashError(
        'Hubo cobros o cuentas nuevas mientras cerrabas. Revisa el arqueo y vuelve a cerrar.',
      )
    }
    tx.update(ref, {
      status: 'cerrada',
      closedAt: serverTimestamp(),
      closedBy: uid,
      ...closing,
    })
    tx.update(countersRef(), { openSessionId: null })
    addAudit(db, tx, uid, {
      action: 'cerrar_caja',
      entity: 'cash',
      entityId: session.id,
      summary: `Caja #${session.number} cerrada. Esperado ${formatCop(data.expected)}, contado ${formatCop(countedCash)}`,
      after: { expectedCash: data.expected, countedCash, difference },
      reason: closing.differenceReason,
    })
  })
  return closing
}
