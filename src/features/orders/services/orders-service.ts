/**
 * Cuentas en Firestore (Fase 4) — R-VEN-02…06, R-VEN-11, D-110, D-217.
 * Cada operación es una transacción con un ID generado antes de enviarla (D-203):
 * repetirla no duplica nada. El stock cambia con el patrón producto + movimiento (D-215).
 */
import {
  collection,
  doc,
  FieldPath,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type DocumentSnapshot,
  type Transaction,
} from 'firebase/firestore'
import { businessDateOf } from '@/domain/dates'
import { lossStats, paidOrderStats } from '@/domain/metrics/daily-stats'
import { formatCop } from '@/domain/money'
import { db } from '@/lib/firebase/firestore'
import { toDate, useSubscription } from '@/lib/firebase/use-subscription'
import { addAudit } from '@/features/audit/services/audit'
import { addDailyStats } from '@/features/reports/services/daily-stats'
import { applyMovement } from '@/features/inventory/domain/movements'
import { writeMovement } from '@/features/inventory/services/inventory-service'
import { productFromDoc } from '@/features/products/services/catalog-service'
import { isFree, type Table } from '@/features/tables/domain/tables'
import { tableFromDoc } from '@/features/tables/services/tables-service'
import {
  buildLine,
  roundCancellationError,
  canCloseWithoutConsumption,
  isOpen,
  normalizeLabel,
  OPEN_STATUSES,
  OrderError,
  orderTitle,
  planCancellation,
  splitGroupCancellation,
  tableStatusFor,
  type CancelMode,
  type LineGroup,
  type Order,
  type OrderLine,
  type OrderStatus,
  type OrderType,
  type RoundItem,
} from '../domain/orders'

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

function lineFromMap(lineId: string, x: Record<string, unknown>): OrderLine {
  return {
    lineId,
    productId: String(x.productId ?? ''),
    nameSnap: String(x.nameSnap ?? ''),
    categoryIdSnap: String(x.categoryIdSnap ?? ''),
    unitPrice: Number(x.unitPrice ?? 0),
    unitCostSnap: Number(x.unitCostSnap ?? 0),
    qty: Number(x.qty ?? 0),
    cancelledQty: Number(x.cancelledQty ?? 0),
    lostQty: Number(x.lostQty ?? 0),
    lastCancelId: (x.lastCancelId as string | null) ?? null,
    addedAt: toDate(x.addedAt),
    roundId: String(x.roundId ?? ''),
  }
}

export function orderFromDoc(id: string, x: Record<string, unknown>): Order {
  const items = (x.items ?? {}) as Record<string, Record<string, unknown>>
  const lines = Object.entries(items)
    .map(([lineId, l]) => lineFromMap(lineId, l))
    // Orden de confirmación; las recién escritas (sin hora del servidor aún) van al final.
    .sort(
      (a, b) =>
        (a.addedAt?.getTime() ?? Infinity) - (b.addedAt?.getTime() ?? Infinity) ||
        a.lineId.localeCompare(b.lineId),
    )
  return {
    id,
    number: Number(x.number ?? 0),
    type: x.type === 'barra' ? 'barra' : 'mesa',
    tableId: (x.tableId as string | null) ?? null,
    tableName: (x.tableName as string | null) ?? null,
    label: (x.label as string | null) ?? null,
    status: (x.status as OrderStatus) ?? 'abierta',
    cashSessionId: String(x.cashSessionId ?? ''),
    businessDate: String(x.businessDate ?? ''),
    lines,
    subtotal: Number(x.subtotal ?? 0),
    total: Number(x.total ?? 0),
    paidTotal: Number(x.paidTotal ?? 0),
    balance: Number(x.balance ?? 0),
    openedAt: toDate(x.openedAt),
    closedAt: toDate(x.closedAt),
    rounds: Object.fromEntries(
      Object.entries((x.rounds ?? {}) as Record<string, unknown>).map(([k, v]) => [k, Number(v)]),
    ),
  }
}

/** Cuentas abiertas o por cobrar (mesas y barra). */
export function useOpenOrders() {
  return useSubscription<Order[]>(
    (onData, onError) =>
      onSnapshot(
        query(collection(db, 'orders'), where('status', 'in', [...OPEN_STATUSES])),
        (snap) =>
          onData(
            snap.docs.map((d) => orderFromDoc(d.id, d.data())).sort((a, b) => a.number - b.number),
          ),
        onError,
      ),
    'orders/open',
  )
}

/** Una cuenta en tiempo real (null si no existe). */
export function useOrder(orderId: string | undefined) {
  return useSubscription<Order | null>(
    (onData, onError) => {
      if (!orderId) {
        onData(null)
        return () => {}
      }
      return onSnapshot(
        doc(db, 'orders', orderId),
        (snap) => onData(snap.exists() ? orderFromDoc(snap.id, snap.data()) : null),
        onError,
      )
    },
    `orders/${orderId ?? ''}`,
  )
}

/** Cuentas de una jornada, de la más reciente a la más antigua. */
export function useOrdersOfDay(businessDate: string) {
  return useSubscription<Order[]>(
    (onData, onError) =>
      onSnapshot(
        query(collection(db, 'orders'), where('businessDate', '==', businessDate)),
        (snap) =>
          onData(
            snap.docs.map((d) => orderFromDoc(d.id, d.data())).sort((a, b) => b.number - a.number),
          ),
        onError,
      ),
    `orders/day/${businessDate}`,
  )
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

/** Nuevo ID para una operación o una línea. Sin "_" (los IDs de movimiento lo usan de separador). */
export const newId = () => crypto.randomUUID()

const orderRef = (id: string) => doc(db, 'orders', id)
const tableRef = (id: string) => doc(db, 'tables', id)

async function readOpenOrder(tx: Transaction, orderId: string) {
  const snap = await tx.get(orderRef(orderId))
  if (!snap.exists()) throw new OrderError('La cuenta no existe.')
  const order = orderFromDoc(snap.id, snap.data())
  if (!isOpen(order.status)) throw new OrderError('La cuenta ya está cerrada.')
  return order
}

export type OpenTarget =
  { type: 'mesa'; tableId: string } | { type: 'barra'; label?: string | null }

/**
 * Abre una cuenta en una mesa libre o en la barra. Exige caja abierta (D-110, R-VEN-01).
 * Devuelve false si esa cuenta ya existía (reintento).
 */
export async function openOrder(
  uid: string,
  orderId: string,
  target: OpenTarget,
): Promise<boolean> {
  return runTransaction(db, async (tx) => {
    const ordersCounter = doc(db, 'counters', 'orders')
    const [existing, cash, counter, tableSnap] = await Promise.all([
      tx.get(orderRef(orderId)),
      tx.get(doc(db, 'counters', 'cashSessions')),
      tx.get(ordersCounter),
      target.type === 'mesa' ? tx.get(tableRef(target.tableId)) : Promise.resolve(null),
    ])
    if (existing.exists()) return false
    const cashSessionId = cash.data()?.openSessionId as string | null | undefined
    if (!cashSessionId) throw new OrderError('Abre la caja antes de vender.')
    if (!counter.exists()) throw new OrderError('Aún no se preparan los datos de ventas.')

    let table: Table | null = null
    if (tableSnap) {
      if (!tableSnap.exists()) throw new OrderError('La mesa no existe.')
      table = tableFromDoc(tableSnap.id, tableSnap.data())
      if (!isFree(table)) throw new OrderError(`${table.name} no está disponible.`)
    }

    const number = Number(counter.data().last ?? 0) + 1
    const type: OrderType = target.type
    tx.update(ordersCounter, { last: number })
    tx.set(orderRef(orderId), {
      number,
      type,
      tableId: table?.id ?? null,
      tableName: table?.name ?? null,
      label: target.type === 'barra' ? normalizeLabel(target.label) : null,
      status: 'abierta',
      cashSessionId,
      businessDate: businessDateOf(new Date()),
      items: {},
      rounds: {},
      lastLineId: null,
      subtotal: 0,
      total: 0,
      paidTotal: 0,
      tipTotal: 0,
      balance: 0,
      uid,
      openedAt: serverTimestamp(),
      closedAt: null,
      updatedAt: serverTimestamp(),
    })
    if (table) tx.update(tableRef(table.id), { status: 'ocupada', currentOrderId: orderId })
    return true
  })
}

export interface AddLineResult {
  created: boolean
  productName: string
  stockAfter: number
  minStock: number
}

/**
 * Confirma una línea de la ronda (R-VEN-03, D-101): valida producto y stock, descuenta,
 * crea el movimiento `venta` y agrega la línea con precio y costo congelados.
 */
export async function addLine(
  uid: string,
  orderId: string,
  item: RoundItem,
  roundId: string,
): Promise<AddLineResult> {
  const movementId = `sale_${orderId}_${item.lineId}`
  return runTransaction(db, async (tx) => {
    const [movementSnap, productSnap] = await Promise.all([
      tx.get(doc(db, 'inventoryMovements', movementId)),
      tx.get(doc(db, 'products', item.productId)),
    ])
    if (!productSnap.exists()) throw new OrderError('El producto no existe.')
    const product = productFromDoc(productSnap.id, productSnap.data())
    if (movementSnap.exists()) {
      // Doble toque o reintento: ya quedó registrada.
      return {
        created: false,
        productName: product.name,
        stockAfter: product.stock,
        minStock: product.minStock,
      }
    }
    const order = await readOpenOrder(tx, orderId)

    const line = { ...buildLine(product, item.qty), roundId }
    const result = applyMovement(
      { stock: product.stock, avgCost: product.avgCost },
      { type: 'venta', quantity: item.qty },
    )
    writeMovement(tx, uid, movementId, productSnap as DocumentSnapshot, 'venta', result, null, {
      type: 'venta',
      id: orderId,
    })
    const subtotal = order.subtotal + line.unitPrice * line.qty
    tx.update(
      orderRef(orderId),
      new FieldPath('items', item.lineId),
      { ...line, addedAt: serverTimestamp() },
      'lastLineId',
      item.lineId,
      'subtotal',
      subtotal,
      'total',
      subtotal,
      'balance',
      subtotal - order.paidTotal,
      // R-VEN-02: agregar productos regresa la cuenta a "abierta".
      'status',
      'abierta',
      'updatedAt',
      serverTimestamp(),
    )
    if (order.type === 'mesa' && order.status === 'por_cobrar' && order.tableId) {
      tx.update(tableRef(order.tableId), { status: 'ocupada' })
    }
    return {
      created: true,
      productName: product.name,
      stockAfter: result.stockAfter,
      minStock: product.minStock,
    }
  })
}

export interface CancelRequest {
  orderId: string
  lineId: string
  /** ID de la operación, generado al abrir el diálogo (D-203). */
  opId: string
  qty: number
  mode: CancelMode
  reason: string
}

/**
 * Cancela toda o parte de una línea (R-VEN-05, D-217). `devolver` regresa el stock con un
 * movimiento `cancelacion_item`; `perdida` (ya servido) no mueve stock y cuenta como pérdida.
 */
export async function cancelLine(uid: string, req: CancelRequest): Promise<boolean> {
  const movementId = `cancel_${req.orderId}_${req.lineId}_${req.opId}`
  return runTransaction(db, async (tx) => {
    const order = await readOpenOrder(tx, req.orderId)
    const line = order.lines.find((l) => l.lineId === req.lineId)
    if (!line) throw new OrderError('La línea no existe.')
    if (line.lastCancelId === req.opId) return false // reintento

    const plan = planCancellation(line, req.qty, req.mode, req.reason)
    // D-230: lo cobrado de una ronda no se cancela ni se devuelve.
    const unitsOut = plan.cancelledQty + plan.lostQty - line.cancelledQty - line.lostQty
    const roundError = roundCancellationError(order, line, unitsOut)
    if (roundError) throw new OrderError(roundError)
    const reason = req.reason.trim()
    if (plan.returnQty > 0) {
      const productSnap = await tx.get(doc(db, 'products', line.productId))
      if (!productSnap.exists()) throw new OrderError('El producto ya no existe.')
      const p = productSnap.data()
      const result = applyMovement(
        { stock: Number(p.stock ?? 0), avgCost: Number(p.avgCost ?? 0) },
        { type: 'cancelacion_item', quantity: plan.returnQty, reason },
      )
      writeMovement(tx, uid, movementId, productSnap, 'cancelacion_item', result, reason, {
        type: 'venta',
        id: req.orderId,
      })
    }
    const subtotal = order.subtotal + plan.subtotalDelta
    // D-219: sin reembolsos. Lo ya pagado no se puede cancelar.
    if (subtotal < order.paidTotal) {
      throw new OrderError(
        `Ya se pagaron ${formatCop(order.paidTotal)} de esta cuenta y no hay reembolsos: solo se puede cancelar hasta ${formatCop(order.subtotal - order.paidTotal)}.`,
      )
    }
    const linePath = (field: string) => new FieldPath('items', req.lineId, field)
    tx.update(
      orderRef(req.orderId),
      linePath('cancelledQty'),
      plan.cancelledQty,
      linePath('lostQty'),
      plan.lostQty,
      linePath('lastCancelId'),
      req.opId,
      'lastLineId',
      req.lineId,
      'subtotal',
      subtotal,
      'total',
      subtotal,
      'balance',
      subtotal - order.paidTotal,
      'updatedAt',
      serverTimestamp(),
    )
    if (req.mode === 'perdida') {
      addDailyStats(db, tx, order.businessDate, lossStats(req.qty, line.unitCostSnap))
    }
    addAudit(db, tx, uid, {
      action: req.mode === 'devolver' ? 'cancelar_item' : 'item_perdido',
      entity: 'order',
      entityId: req.orderId,
      summary:
        req.mode === 'devolver'
          ? `${orderTitle(order)}: ${req.qty} × ${line.nameSnap} cancelado, vuelve al stock`
          : `${orderTitle(order)}: ${req.qty} × ${line.nameSnap} servido y no cobrado (pérdida ${formatCop(req.qty * line.unitCostSnap)} a costo)`,
      before: { activas: line.qty - line.cancelledQty - line.lostQty },
      after: { activas: line.qty - plan.cancelledQty - plan.lostQty },
      reason,
    })
    return true
  })
}

/**
 * Cancela unidades de un renglón agrupado (D-218): reparte la cantidad entre sus líneas y
 * registra una cancelación por línea. Cada parte usa `{opId}-{n}`, así un reintento no duplica.
 */
export async function cancelGroup(
  uid: string,
  req: {
    orderId: string
    group: LineGroup
    opId: string
    qty: number
    mode: CancelMode
    reason: string
  },
): Promise<void> {
  const parts = splitGroupCancellation(req.group, req.qty)
  for (const [i, part] of parts.entries()) {
    await cancelLine(uid, {
      orderId: req.orderId,
      lineId: part.line.lineId,
      opId: `${req.opId}-${i}`,
      qty: part.qty,
      mode: req.mode,
      reason: req.reason,
    })
  }
}

/** Pedir cuenta (`por_cobrar`) o volver a `abierta`. La mesa cambia de color (R-VEN-02). */
export async function setOrderStatus(orderId: string, status: 'abierta' | 'por_cobrar') {
  await runTransaction(db, async (tx) => {
    const order = await readOpenOrder(tx, orderId)
    if (order.status === status) return
    tx.update(orderRef(orderId), { status, updatedAt: serverTimestamp() })
    if (order.type === 'mesa' && order.tableId) {
      tx.update(tableRef(order.tableId), { status: tableStatusFor(status) })
    }
  })
}

/** Cambia el nombre de una cuenta de barra. */
export async function setOrderLabel(orderId: string, label: string | null) {
  await runTransaction(db, async (tx) => {
    const order = await readOpenOrder(tx, orderId)
    if (order.type !== 'barra') throw new OrderError('Solo las cuentas de barra tienen nombre.')
    tx.update(orderRef(orderId), { label: normalizeLabel(label), updatedAt: serverTimestamp() })
  })
}

/** Mueve la cuenta a otra mesa libre (de mesa a mesa o de la barra a una mesa). */
export async function moveOrder(uid: string, orderId: string, toTableId: string) {
  await runTransaction(db, async (tx) => {
    const order = await readOpenOrder(tx, orderId)
    const targetSnap = await tx.get(tableRef(toTableId))
    if (!targetSnap.exists()) throw new OrderError('La mesa no existe.')
    const target = tableFromDoc(targetSnap.id, targetSnap.data())
    if (target.id === order.tableId) return
    if (!isFree(target)) throw new OrderError(`${target.name} no está disponible.`)

    tx.update(orderRef(orderId), {
      type: 'mesa',
      tableId: target.id,
      tableName: target.name,
      updatedAt: serverTimestamp(),
    })
    tx.update(tableRef(target.id), {
      status: tableStatusFor(order.status),
      currentOrderId: orderId,
    })
    if (order.type === 'mesa' && order.tableId) {
      tx.update(tableRef(order.tableId), { status: 'disponible', currentOrderId: null })
    }
    addAudit(db, tx, uid, {
      action: 'mover_cuenta',
      entity: 'order',
      entityId: orderId,
      summary: `Cuenta #${order.number} movida: ${orderTitle(order)} → ${target.name}`,
      before: { tableId: order.tableId },
      after: { tableId: target.id },
    })
  })
}

/**
 * Cierra una cuenta ya cobrada en su totalidad y libera la mesa (D-230). La cuenta no se cierra
 * sola al cobrar una ronda: queda abierta para seguir pidiendo hasta que se cierre aquí.
 * La venta se suma al resumen del día al cerrar (F-04, F-07).
 */
export async function closeOrder(uid: string, orderId: string) {
  await runTransaction(db, async (tx) => {
    const order = await readOpenOrder(tx, orderId)
    if (order.subtotal === 0)
      throw new OrderError('Esta cuenta no tiene consumo: ciérrala sin consumo.')
    if (order.balance !== 0) throw new OrderError(`Falta cobrar ${formatCop(order.balance)}.`)
    tx.update(orderRef(orderId), {
      status: 'pagada',
      closedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    if (order.type === 'mesa' && order.tableId) {
      tx.update(tableRef(order.tableId), { status: 'disponible', currentOrderId: null })
    }
    addDailyStats(db, tx, order.businessDate, paidOrderStats(order.lines, new Date()))
    addAudit(db, tx, uid, {
      action: 'cuenta_pagada',
      entity: 'order',
      entityId: orderId,
      summary: `Cuenta #${order.number} (${orderTitle(order)}) cerrada: ${formatCop(order.total)}`,
    })
  })
}

/** Cierra una cuenta sin nada por cobrar y libera la mesa (D-217). */
export async function closeWithoutConsumption(uid: string, orderId: string, reason: string | null) {
  await runTransaction(db, async (tx) => {
    const order = await readOpenOrder(tx, orderId)
    if (!canCloseWithoutConsumption(order)) {
      throw new OrderError('La cuenta tiene productos por cobrar.')
    }
    tx.update(orderRef(orderId), {
      status: 'cerrada_sin_consumo',
      closedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    if (order.type === 'mesa' && order.tableId) {
      tx.update(tableRef(order.tableId), { status: 'disponible', currentOrderId: null })
    }
    addAudit(db, tx, uid, {
      action: 'cerrar_sin_consumo',
      entity: 'order',
      entityId: orderId,
      summary: `Cuenta #${order.number} (${orderTitle(order)}) cerrada sin consumo`,
      reason: reason?.trim() || null,
    })
  })
}
