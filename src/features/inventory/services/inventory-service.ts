/**
 * Movimientos de inventario en Firestore (Fase 3).
 * R-INV-01: el stock solo cambia en una transacción que crea, en el mismo commit, el movimiento.
 * D-203: cada operación usa un ID generado antes de enviarla (opId); si se repite, no hace nada.
 * Las reglas de Firestore exigen que producto y movimiento coincidan (lastMovementId).
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
  type DocumentSnapshot,
  type Transaction,
} from 'firebase/firestore'
import { businessDateOf } from '@/domain/dates'
import { db } from '@/lib/firebase/firestore'
import { toDate, useSubscription } from '@/lib/firebase/use-subscription'
import { addAudit } from '@/features/audit/services/audit'
import {
  applyMovement,
  InventoryError,
  LOSS_TYPES,
  MOVEMENT_LABELS,
  type MovementResult,
  type MovementType,
} from '../domain/movements'

export interface InventoryMovement {
  id: string
  productId: string
  productName: string
  type: MovementType
  qty: number
  stockBefore: number
  stockAfter: number
  avgCostBefore: number
  avgCostAfter: number
  unitCost: number
  reason: string | null
  businessDate: string
  createdAt: Date | null
}

/** Nuevo ID de operación (idempotencia). Se genera al abrir el formulario, no al enviar. */
export const newOpId = () => crypto.randomUUID()

/** Escribe producto + movimiento (+ historial de costo) dentro de una transacción. */
function writeMovement(
  tx: Transaction,
  uid: string,
  movementId: string,
  productSnap: DocumentSnapshot,
  type: MovementType,
  result: MovementResult,
  reason: string | null,
  source: { type: 'ajuste' | 'conteo'; id: string },
) {
  const product = productSnap.data()!
  const productRef = productSnap.ref
  const now = serverTimestamp()
  const costChanged = result.avgCostAfter !== result.avgCostBefore

  tx.update(productRef, {
    stock: result.stockAfter,
    avgCost: result.avgCostAfter,
    ...(type.startsWith('entrada') ? { lastPurchaseCost: result.unitCost } : {}),
    lastMovementId: movementId,
    updatedAt: now,
  })
  tx.set(doc(db, 'inventoryMovements', movementId), {
    productId: productRef.id,
    productName: String(product.name ?? ''),
    type,
    qty: result.qty,
    stockBefore: result.stockBefore,
    stockAfter: result.stockAfter,
    avgCostBefore: result.avgCostBefore,
    avgCostAfter: result.avgCostAfter,
    unitCost: result.unitCost,
    sourceType: source.type,
    sourceId: source.id,
    reason,
    businessDate: businessDateOf(new Date()),
    uid,
    createdAt: now,
  })
  if (costChanged) {
    tx.set(doc(collection(db, 'priceHistory')), {
      productId: productRef.id,
      field: 'avgCost',
      oldValue: result.avgCostBefore,
      newValue: result.avgCostAfter,
      source: 'ajuste',
      reason: null,
      at: now,
    })
  }
}

export interface MovementRequest {
  opId: string
  productId: string
  type: MovementType
  quantity: number
  unitCost?: number
  reason?: string | null
}

/** Registra un movimiento manual (entrada, merma, ajuste…). Devuelve false si ya existía. */
export async function registerMovement(uid: string, req: MovementRequest): Promise<boolean> {
  const movementId = `adj_${req.opId}`
  return runTransaction(db, async (tx) => {
    const movementRef = doc(db, 'inventoryMovements', movementId)
    const productRef = doc(db, 'products', req.productId)
    const [movementSnap, productSnap] = await Promise.all([tx.get(movementRef), tx.get(productRef)])
    if (movementSnap.exists()) return false // reintento o doble toque: ya quedó registrado
    if (!productSnap.exists()) throw new InventoryError('El producto no existe.')

    const p = productSnap.data()
    const reason = req.reason?.trim() || null
    const result = applyMovement(
      { stock: Number(p.stock ?? 0), avgCost: Number(p.avgCost ?? 0) },
      { type: req.type, quantity: req.quantity, unitCost: req.unitCost, reason },
    )
    writeMovement(tx, uid, movementId, productSnap, req.type, result, reason, {
      type: 'ajuste',
      id: req.opId,
    })
    if (LOSS_TYPES.includes(req.type) || req.type === 'ajuste_positivo') {
      addAudit(db, tx, uid, {
        action: req.type,
        entity: 'inventory',
        entityId: req.productId,
        summary: `${MOVEMENT_LABELS[req.type]}: ${Math.abs(result.qty)} de "${String(p.name)}"`,
        before: { stock: result.stockBefore },
        after: { stock: result.stockAfter },
        reason,
      })
    }
    return true
  })
}

export interface CountLine {
  productId: string
  counted: number
}

/**
 * Productos por transacción al aplicar un conteo. Las reglas de Firestore permiten un número
 * limitado de lecturas por transacción; con 4 productos queda margen.
 */
export const COUNT_CHUNK = 4

/**
 * Aplica un conteo físico: por cada producto con diferencia crea un movimiento "conteo".
 * Idempotente por producto (ID determinista), así que se puede reintentar si se corta la red.
 */
export async function applyCount(
  uid: string,
  countId: string,
  lines: CountLine[],
  reason: string,
): Promise<{ adjusted: number }> {
  let adjusted = 0
  for (let i = 0; i < lines.length; i += COUNT_CHUNK) {
    const chunk = lines.slice(i, i + COUNT_CHUNK)
    adjusted += await runTransaction(db, async (tx) => {
      const snaps = await Promise.all(
        chunk.map(async (l) => {
          const movementId = `count_${countId}_${l.productId}`
          const [m, p] = await Promise.all([
            tx.get(doc(db, 'inventoryMovements', movementId)),
            tx.get(doc(db, 'products', l.productId)),
          ])
          return { line: l, movementId, movementSnap: m, productSnap: p }
        }),
      )
      let n = 0
      for (const { line, movementId, movementSnap, productSnap } of snaps) {
        if (movementSnap.exists() || !productSnap.exists()) continue
        const p = productSnap.data()
        const diff = line.counted - Number(p.stock ?? 0)
        if (diff === 0) continue
        const result = applyMovement(
          { stock: Number(p.stock ?? 0), avgCost: Number(p.avgCost ?? 0) },
          { type: 'conteo', quantity: diff, reason },
        )
        writeMovement(tx, uid, movementId, productSnap, 'conteo', result, reason, {
          type: 'conteo',
          id: countId,
        })
        n++
      }
      return n
    })
  }
  // Resumen del conteo para la auditoría.
  await runTransaction(db, async (tx) => {
    addAudit(db, tx, uid, {
      action: 'conteo',
      entity: 'inventory',
      entityId: countId,
      summary: `Conteo físico: ${lines.length} productos revisados, ${adjusted} ajustados`,
      reason,
    })
  })
  return { adjusted }
}

function movementFromDoc(id: string, x: Record<string, unknown>): InventoryMovement {
  return {
    id,
    productId: String(x.productId),
    productName: String(x.productName ?? ''),
    type: x.type as MovementType,
    qty: Number(x.qty),
    stockBefore: Number(x.stockBefore),
    stockAfter: Number(x.stockAfter),
    avgCostBefore: Number(x.avgCostBefore),
    avgCostAfter: Number(x.avgCostAfter),
    unitCost: Number(x.unitCost),
    reason: (x.reason as string | null) ?? null,
    businessDate: String(x.businessDate ?? ''),
    createdAt: toDate(x.createdAt),
  }
}

/** Kardex de un producto: últimos movimientos, del más reciente al más antiguo. */
export function useProductMovements(productId: string | undefined, max = 100) {
  return useSubscription<InventoryMovement[]>(
    (onData, onError) => {
      if (!productId) {
        onData([])
        return () => {}
      }
      return onSnapshot(
        query(
          collection(db, 'inventoryMovements'),
          where('productId', '==', productId),
          orderBy('createdAt', 'desc'),
          limit(max),
        ),
        (snap) => onData(snap.docs.map((d) => movementFromDoc(d.id, d.data()))),
        onError,
      )
    },
    `movements/${productId ?? ''}/${max}`,
  )
}
