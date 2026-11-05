/**
 * Revisión de inventario periódica en `counters/inventoryReview` (R-INV-11, D-221).
 * Las reglas exigen la caja cerrada para empezar y bloquean abrir caja mientras está en curso.
 */
import { doc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore'
import { businessDateOf, formatBusinessDateLong, isBusinessDate } from '@/domain/dates'
import { db } from '@/lib/firebase/firestore'
import { toDate, useSubscription } from '@/lib/firebase/use-subscription'
import { addAudit } from '@/features/audit/services/audit'
import {
  DEFAULT_REVIEW_MONTHS,
  validateSchedule,
  type InventoryReviewState,
} from '../domain/review'

export class ReviewError extends Error {
  override name = 'ReviewError'
}

const reviewRef = () => doc(db, 'counters', 'inventoryReview')
const cashCounterRef = () => doc(db, 'counters', 'cashSessions')

export function reviewFromDoc(x: Record<string, unknown>): InventoryReviewState {
  return {
    periodMonths: Number(x.periodMonths ?? DEFAULT_REVIEW_MONTHS),
    lastReviewDate: String(x.lastReviewDate),
    scheduledDate: (x.scheduledDate as string | null) ?? null,
    inProgressId: (x.inProgressId as string | null) ?? null,
    startedAt: toDate(x.startedAt),
  }
}

/** Estado de la revisión (null mientras no exista: se crea solo al entrar). */
export function useInventoryReview() {
  return useSubscription<InventoryReviewState | null>(
    (onData, onError) =>
      onSnapshot(
        reviewRef(),
        (snap) => onData(snap.exists() ? reviewFromDoc(snap.data()) : null),
        onError,
      ),
    'counters/inventoryReview',
  )
}

/**
 * Primera vez de la Fase 6: el periodo empieza hoy (el usuario puede cambiar la fecha de la
 * última revisión en Configuración). Idempotente.
 */
export async function ensureInventoryReview(uid: string): Promise<boolean> {
  return runTransaction(db, async (tx) => {
    if ((await tx.get(reviewRef())).exists()) return false
    const today = businessDateOf(new Date())
    tx.set(reviewRef(), {
      periodMonths: DEFAULT_REVIEW_MONTHS,
      lastReviewDate: today,
      scheduledDate: null,
      inProgressId: null,
      startedAt: null,
      updatedAt: serverTimestamp(),
    })
    addAudit(db, tx, uid, {
      action: 'inicializar',
      entity: 'inventory',
      entityId: 'revision',
      summary: `Revisión de inventario cada ${DEFAULT_REVIEW_MONTHS} meses, contando desde hoy`,
    })
    return true
  })
}

/** Programa (o quita) el día de la próxima revisión. */
export async function scheduleReview(uid: string, date: string | null) {
  if (date !== null) {
    const error = validateSchedule(date, businessDateOf(new Date()))
    if (error) throw new ReviewError(error)
  }
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(reviewRef())
    if (!snap.exists()) throw new ReviewError('Aún no se prepara la revisión de inventario.')
    tx.update(reviewRef(), { scheduledDate: date, updatedAt: serverTimestamp() })
    addAudit(db, tx, uid, {
      action: 'programar_revision',
      entity: 'inventory',
      entityId: 'revision',
      summary: date
        ? `Revisión de inventario programada para el ${formatBusinessDateLong(date)}`
        : 'Se quitó el día programado de la revisión de inventario',
      before: { scheduledDate: snap.data().scheduledDate ?? null },
      after: { scheduledDate: date },
    })
  })
}

/** Periodo y fecha de la última revisión (Configuración). */
export async function saveReviewSettings(
  uid: string,
  periodMonths: number,
  lastReviewDate: string,
) {
  if (!Number.isInteger(periodMonths) || periodMonths < 1 || periodMonths > 12) {
    throw new ReviewError('El periodo debe estar entre 1 y 12 meses.')
  }
  if (!isBusinessDate(lastReviewDate) || lastReviewDate > businessDateOf(new Date())) {
    throw new ReviewError('La última revisión no puede ser una fecha futura.')
  }
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(reviewRef())
    if (!snap.exists()) throw new ReviewError('Aún no se prepara la revisión de inventario.')
    const before = reviewFromDoc(snap.data())
    tx.update(reviewRef(), { periodMonths, lastReviewDate, updatedAt: serverTimestamp() })
    addAudit(db, tx, uid, {
      action: 'configurar_revision',
      entity: 'inventory',
      entityId: 'revision',
      summary: `Revisión de inventario cada ${periodMonths} meses; última el ${formatBusinessDateLong(lastReviewDate)}`,
      before: { periodMonths: before.periodMonths, lastReviewDate: before.lastReviewDate },
      after: { periodMonths, lastReviewDate },
    })
  })
}

/**
 * Empieza la revisión completa: solo con la caja cerrada; mientras dure no se abre caja.
 * `reviewId` se genera antes (D-203): si ya es la revisión en curso, no hace nada.
 */
export async function startReview(uid: string, reviewId: string) {
  await runTransaction(db, async (tx) => {
    const [snap, cash] = await Promise.all([tx.get(reviewRef()), tx.get(cashCounterRef())])
    if (!snap.exists()) throw new ReviewError('Aún no se prepara la revisión de inventario.')
    const current = snap.data().inProgressId as string | null
    if (current === reviewId) return
    if (current) throw new ReviewError('Ya hay una revisión en curso.')
    if (cash.data()?.openSessionId) {
      throw new ReviewError(
        'Cierra la caja para empezar la revisión: no se cuenta mientras se vende.',
      )
    }
    tx.update(reviewRef(), {
      inProgressId: reviewId,
      startedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    addAudit(db, tx, uid, {
      action: 'iniciar_revision',
      entity: 'inventory',
      entityId: reviewId,
      summary: 'Revisión de inventario iniciada (caja cerrada)',
    })
  })
}

/** Cancela la revisión en curso sin cambiar la fecha de la última revisión. */
export async function cancelReview(uid: string, reviewId: string) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(reviewRef())
    if (snap.data()?.inProgressId !== reviewId) return
    tx.update(reviewRef(), { inProgressId: null, startedAt: null, updatedAt: serverTimestamp() })
    addAudit(db, tx, uid, {
      action: 'cancelar_revision',
      entity: 'inventory',
      entityId: reviewId,
      summary: 'Revisión de inventario cancelada',
    })
  })
}

/** Termina la revisión: hoy pasa a ser la última y empieza el siguiente periodo. */
export async function finishReview(uid: string, reviewId: string, summary: string) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(reviewRef())
    if (snap.data()?.inProgressId !== reviewId) return
    tx.update(reviewRef(), {
      inProgressId: null,
      startedAt: null,
      scheduledDate: null,
      lastReviewDate: businessDateOf(new Date()),
      updatedAt: serverTimestamp(),
    })
    addAudit(db, tx, uid, {
      action: 'terminar_revision',
      entity: 'inventory',
      entityId: reviewId,
      summary,
    })
  })
}
