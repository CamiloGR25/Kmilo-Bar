/**
 * Auditoría (R-AUD-01/02): se escribe en el mismo batch/transacción que la operación.
 */
import {
  doc,
  collection,
  serverTimestamp,
  type Transaction,
  type WriteBatch,
  type Firestore,
} from 'firebase/firestore'

export type AuditEntity =
  | 'settings'
  | 'category'
  | 'product'
  | 'catalog'
  | 'inventory'
  | 'cash'
  | 'table'
  | 'order'
  | 'stats'
  | 'supplier'
  | 'purchase'

export interface AuditEntryInput {
  action: string
  entity: AuditEntity
  entityId: string
  summary: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  reason?: string | null
}

/** Agrega un registro de auditoría al batch o transacción. Solo guarda los campos que cambiaron. */
export function addAudit(
  db: Firestore,
  writer: WriteBatch | Transaction,
  uid: string,
  input: AuditEntryInput,
) {
  ;(writer as WriteBatch).set(doc(collection(db, 'auditLog')), {
    action: input.action,
    entity: input.entity,
    entityId: input.entityId,
    summary: input.summary,
    before: input.before ?? null,
    after: input.after ?? null,
    reason: input.reason ?? null,
    uid,
    at: serverTimestamp(),
  })
}

/** Devuelve solo los campos que cambiaron entre dos objetos planos. */
export function changedFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Partial<T>; after: Partial<T> } | null {
  const b: Partial<T> = {}
  const a: Partial<T> = {}
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (before[key] !== after[key]) {
      b[key] = before[key]
      a[key] = after[key]
    }
  }
  return Object.keys(a).length > 0 ? { before: b, after: a } : null
}
