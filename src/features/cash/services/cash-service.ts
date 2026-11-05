/**
 * Caja en Firestore: apertura (Fase 4, D-217). El cierre y el arqueo llegan en la Fase 5.
 * `counters/cashSessions.openSessionId` apunta a la única caja abierta (R-PAG-07).
 */
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { businessDateOf } from '@/domain/dates'
import { formatCop } from '@/domain/money'
import { db } from '@/lib/firebase/firestore'
import { toDate, useSubscription } from '@/lib/firebase/use-subscription'
import { addAudit } from '@/features/audit/services/audit'
import { CashError, validateOpeningBalance, type CashSession } from '../domain/cash'

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
  }
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
    const counters = await tx.get(countersRef())
    if (!counters.exists()) throw new CashError('Aún no se preparan los datos de ventas.')
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
