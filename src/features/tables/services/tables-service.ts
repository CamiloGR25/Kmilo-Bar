/**
 * Mesas en Firestore (Fase 4). Abrir, mover y cerrar cuentas cambia la mesa desde
 * orders-service, en la misma transacción que la cuenta (R-VEN-06).
 */
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  writeBatch,
} from 'firebase/firestore'
import { db } from '@/lib/firebase/firestore'
import { useSubscription } from '@/lib/firebase/use-subscription'
import { addAudit } from '@/features/audit/services/audit'
import {
  canChangeService,
  INITIAL_TABLE_COUNT,
  newTable,
  tableIdFor,
  validateTableName,
  type Table,
  type TableStatus,
} from '../domain/tables'

export class TableError extends Error {
  override name = 'TableError'
}

export function tableFromDoc(id: string, x: Record<string, unknown>): Table {
  return {
    id,
    name: String(x.name ?? ''),
    number: Number(x.number ?? 0),
    status: (x.status as TableStatus) ?? 'disponible',
    currentOrderId: (x.currentOrderId as string | null) ?? null,
    active: x.active !== false,
    sortOrder: Number(x.sortOrder ?? 0),
  }
}

/** Todas las mesas (activas e inactivas), por orden. */
export function useTables() {
  return useSubscription<Table[]>(
    (onData, onError) =>
      onSnapshot(
        query(collection(db, 'tables'), orderBy('sortOrder')),
        (snap) => onData(snap.docs.map((d) => tableFromDoc(d.id, d.data()))),
        onError,
      ),
    'tables',
  )
}

/**
 * Primera vez de la Fase 4: crea las 5 mesas y los contadores de cuentas y cajas.
 * Idempotente: si `counters/orders` ya existe, no hace nada.
 */
export async function ensureSalesSetup(uid: string): Promise<boolean> {
  return runTransaction(db, async (tx) => {
    const ordersCounter = doc(db, 'counters', 'orders')
    if ((await tx.get(ordersCounter)).exists()) return false
    tx.set(ordersCounter, { last: 0 })
    tx.set(doc(db, 'counters', 'cashSessions'), { last: 0, openSessionId: null })
    for (let n = 1; n <= INITIAL_TABLE_COUNT; n++) {
      tx.set(doc(db, 'tables', tableIdFor(n)), newTable(n))
    }
    addAudit(db, tx, uid, {
      action: 'inicializar',
      entity: 'table',
      entityId: 'general',
      summary: `${INITIAL_TABLE_COUNT} mesas iniciales y contadores de ventas creados`,
    })
    return true
  })
}

export async function createTable(uid: string, number: number, name: string) {
  const error = validateTableName(name)
  if (error) throw new TableError(error)
  const ref = doc(db, 'tables', tableIdFor(number))
  await runTransaction(db, async (tx) => {
    if ((await tx.get(ref)).exists()) throw new TableError(`Ya existe la mesa ${number}.`)
    tx.set(ref, newTable(number, name))
    addAudit(db, tx, uid, {
      action: 'crear',
      entity: 'table',
      entityId: ref.id,
      summary: `Mesa creada: ${name.trim()}`,
    })
  })
}

export async function renameTable(uid: string, table: Table, name: string) {
  const error = validateTableName(name)
  if (error) throw new TableError(error)
  const batch = writeBatch(db)
  batch.update(doc(db, 'tables', table.id), { name: name.trim() })
  addAudit(db, batch, uid, {
    action: 'renombrar',
    entity: 'table',
    entityId: table.id,
    summary: `Mesa renombrada: ${table.name} → ${name.trim()}`,
    before: { name: table.name },
    after: { name: name.trim() },
  })
  await batch.commit()
}

/** Fuera de servicio ↔ disponible, o activar/desactivar. Solo si la mesa no tiene cuenta. */
export async function updateTableService(
  uid: string,
  table: Table,
  change: { outOfService?: boolean; active?: boolean },
) {
  const ref = doc(db, 'tables', table.id)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    const current = tableFromDoc(snap.id, snap.data() ?? {})
    if (!canChangeService(current)) {
      throw new TableError(`${current.name} tiene una cuenta abierta.`)
    }
    const status: TableStatus =
      change.outOfService === undefined
        ? current.status
        : change.outOfService
          ? 'fuera_servicio'
          : 'disponible'
    const active = change.active ?? current.active
    tx.update(ref, { status, active })
    addAudit(db, tx, uid, {
      action: change.active === undefined ? 'servicio' : active ? 'activar' : 'desactivar',
      entity: 'table',
      entityId: table.id,
      summary:
        change.active === undefined
          ? `${current.name}: ${status === 'fuera_servicio' ? 'fuera de servicio' : 'disponible'}`
          : `${current.name} ${active ? 'activada' : 'desactivada'}`,
      before: { status: current.status, active: current.active },
      after: { status, active },
    })
  })
}
