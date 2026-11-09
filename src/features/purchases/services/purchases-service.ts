/**
 * Proveedores, pedidos, recepciones y pagos en Firestore (Fase 7, D-223).
 * R-COM-02: cada recepción suma stock y recalcula el costo promedio con el patrón de
 * inventario (producto + movimiento en la misma transacción, D-215), en grupos de
 * RECEPTION_CHUNK líneas por el límite de lecturas de las reglas.
 */
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentSnapshot,
} from 'firebase/firestore'
import { businessDateOf } from '@/domain/dates'
import { purchaseStats, supplierPaymentStats } from '@/domain/metrics/daily-stats'
import { formatCop } from '@/domain/money'
import { db } from '@/lib/firebase/firestore'
import { toDate, useSubscription } from '@/lib/firebase/use-subscription'
import { addAudit } from '@/features/audit/services/audit'
import { applyMovement } from '@/features/inventory/domain/movements'
import { writeMovement } from '@/features/inventory/services/inventory-service'
import { addDailyStats } from '@/features/reports/services/daily-stats'
import type { TransferChannel } from '@/features/cash/domain/payments'
import {
  chunk,
  estTotalOf,
  paymentStatusOf,
  PurchaseError,
  RECEIVABLE,
  RECEPTION_CHUNK,
  statusAfterReception,
  validateLines,
  validateSupplierPayment,
  type DraftLineInput,
  type PaymentStatus,
  type PurchaseKind,
  type PurchaseLine,
  type PurchaseOrder,
  type PurchaseStatus,
  type ReceptionPlan,
  type Supplier,
  type SupplierPayMethod,
} from '../domain/purchases'

export const newId = () => crypto.randomUUID()

// ---------------------------------------------------------------------------
// Proveedores (F7-01)
// ---------------------------------------------------------------------------

export function supplierFromDoc(id: string, x: Record<string, unknown>): Supplier {
  return {
    id,
    name: String(x.name ?? ''),
    contactName: String(x.contactName ?? ''),
    phone: String(x.phone ?? ''),
    notes: String(x.notes ?? ''),
    active: x.active !== false,
    lastCosts: (x.lastCosts ?? {}) as Record<string, number>,
  }
}

export function useSuppliers() {
  return useSubscription<Supplier[]>(
    (onData, onError) =>
      onSnapshot(
        query(collection(db, 'suppliers'), orderBy('name')),
        (snap) => onData(snap.docs.map((d) => supplierFromDoc(d.id, d.data()))),
        onError,
      ),
    'suppliers',
  )
}

export interface SupplierInput {
  name: string
  contactName: string
  phone: string
  notes: string
}

export function validateSupplier(v: SupplierInput, otherNames: readonly string[]): string | null {
  const name = v.name.trim()
  if (name.length < 2) return 'Escribe el nombre del proveedor.'
  if (name.length > 80) return 'El nombre es demasiado largo.'
  if (otherNames.includes(name.toLowerCase())) return 'Ya existe un proveedor con ese nombre.'
  if (v.phone.trim().length > 30) return 'El teléfono es demasiado largo.'
  if (v.contactName.trim().length > 80) return 'El contacto es demasiado largo.'
  if (v.notes.trim().length > 300) return 'Las notas son demasiado largas.'
  return null
}

const clean = (v: SupplierInput) => ({
  name: v.name.trim(),
  contactName: v.contactName.trim(),
  phone: v.phone.trim(),
  notes: v.notes.trim(),
})

export async function createSupplier(uid: string, v: SupplierInput) {
  const ref = doc(collection(db, 'suppliers'))
  const batch = writeBatch(db)
  batch.set(ref, {
    ...clean(v),
    active: true,
    lastCosts: {},
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  addAudit(db, batch, uid, {
    action: 'crear',
    entity: 'supplier',
    entityId: ref.id,
    summary: `Proveedor "${v.name.trim()}" creado`,
  })
  await batch.commit()
  return ref.id
}

export async function updateSupplier(uid: string, s: Supplier, v: SupplierInput) {
  const batch = writeBatch(db)
  batch.update(doc(db, 'suppliers', s.id), { ...clean(v), updatedAt: serverTimestamp() })
  addAudit(db, batch, uid, {
    action: 'actualizar',
    entity: 'supplier',
    entityId: s.id,
    summary: `Proveedor "${v.name.trim()}" actualizado`,
  })
  await batch.commit()
}

export async function setSupplierActive(uid: string, s: Supplier, active: boolean) {
  const batch = writeBatch(db)
  batch.update(doc(db, 'suppliers', s.id), { active, updatedAt: serverTimestamp() })
  addAudit(db, batch, uid, {
    action: active ? 'activar' : 'desactivar',
    entity: 'supplier',
    entityId: s.id,
    summary: `Proveedor "${s.name}" ${active ? 'activado' : 'desactivado'}`,
  })
  await batch.commit()
}

// ---------------------------------------------------------------------------
// Pedidos (F7-02)
// ---------------------------------------------------------------------------

export function purchaseOrderFromDoc(id: string, x: Record<string, unknown>): PurchaseOrder {
  const items = (x.items ?? {}) as Record<string, Record<string, unknown>>
  const lines: PurchaseLine[] = Object.entries(items)
    .map(([lineId, l]) => ({
      lineId,
      productId: String(l.productId),
      nameSnap: String(l.nameSnap ?? ''),
      qtyOrdered: Number(l.qtyOrdered ?? 0),
      qtyReceived: Number(l.qtyReceived ?? 0),
      estUnitCost: Number(l.estUnitCost ?? 0),
      addedAt: Number(l.addedAt ?? 0),
    }))
    .sort((a, b) => a.addedAt - b.addedAt)
  return {
    id,
    number: Number(x.number ?? 0),
    kind: (x.kind as PurchaseKind) ?? 'pedido',
    supplierId: String(x.supplierId ?? ''),
    supplierName: String(x.supplierName ?? ''),
    status: (x.status as PurchaseStatus) ?? 'borrador',
    shortClosed: x.shortClosed === true,
    lines,
    estTotal: Number(x.estTotal ?? 0),
    receivedTotal: Number(x.receivedTotal ?? 0),
    paidTotal: Number(x.paidTotal ?? 0),
    paymentStatus: (x.paymentStatus as PaymentStatus) ?? 'pendiente',
    expectedDate: (x.expectedDate as string | null) ?? null,
    notes: String(x.notes ?? ''),
    createdAt: toDate(x.createdAt),
    requestedAt: toDate(x.requestedAt),
    closedAt: toDate(x.closedAt),
  }
}

/** Todos los pedidos, del más reciente al más antiguo (un bar pequeño hace pocos). */
export function usePurchaseOrders() {
  return useSubscription<PurchaseOrder[]>(
    (onData, onError) =>
      onSnapshot(
        query(collection(db, 'purchaseOrders'), orderBy('number', 'desc')),
        (snap) => onData(snap.docs.map((d) => purchaseOrderFromDoc(d.id, d.data()))),
        onError,
      ),
    'purchaseOrders',
  )
}

export function usePurchaseOrder(id: string | undefined) {
  return useSubscription<PurchaseOrder | null>(
    (onData, onError) => {
      if (!id) {
        onData(null)
        return () => {}
      }
      return onSnapshot(
        doc(db, 'purchaseOrders', id),
        (snap) => onData(snap.exists() ? purchaseOrderFromDoc(snap.id, snap.data()) : null),
        onError,
      )
    },
    `purchaseOrders/${id ?? ''}`,
  )
}

/** Primera vez de la Fase 7: el consecutivo de pedidos. Idempotente. */
export async function ensurePurchasesSetup(): Promise<boolean> {
  return runTransaction(db, async (tx) => {
    const ref = doc(db, 'counters', 'purchaseOrders')
    if ((await tx.get(ref)).exists()) return false
    tx.set(ref, { last: 0 })
    return true
  })
}

const itemsMap = (lines: readonly DraftLineInput[], existing?: readonly PurchaseLine[]) => {
  const now = Date.now()
  const byProduct = new Map(existing?.map((l) => [l.productId, l]))
  return Object.fromEntries(
    lines.map((l, i) => {
      const prev = byProduct.get(l.productId)
      return [
        prev?.lineId ?? newId(),
        {
          productId: l.productId,
          nameSnap: l.name,
          qtyOrdered: l.qty!,
          qtyReceived: prev?.qtyReceived ?? 0,
          estUnitCost: l.estUnitCost!,
          addedAt: prev?.addedAt ?? now + i,
        },
      ]
    }),
  )
}

export interface OrderInput {
  supplier: Pick<Supplier, 'id' | 'name'>
  lines: DraftLineInput[]
  expectedDate: string | null
  notes: string
}

/**
 * Crea un pedido (borrador) o una compra directa (queda "solicitado" y se recibe enseguida).
 * `orderId` se genera antes (D-203): si ya existe, no hace nada.
 */
export async function createPurchaseOrder(
  uid: string,
  orderId: string,
  kind: PurchaseKind,
  input: OrderInput,
  /** Pedido: `true` lo registra como solicitado sin enviarlo; si no, queda en borrador. */
  register = false,
) {
  const error = validateLines(input.lines)
  if (error) throw new PurchaseError(error)
  if (input.notes.trim().length > 300) throw new PurchaseError('Las notas son demasiado largas.')
  return runTransaction(db, async (tx) => {
    const ref = doc(db, 'purchaseOrders', orderId)
    const counter = doc(db, 'counters', 'purchaseOrders')
    const [snap, c] = await Promise.all([tx.get(ref), tx.get(counter)])
    if (snap.exists()) return Number(snap.data().number)
    if (!c.exists()) throw new PurchaseError('Aún no se preparan las compras. Recarga la página.')
    const number = Number(c.data().last ?? 0) + 1
    const items = itemsMap(input.lines)
    const requested = kind === 'directa' || register
    tx.update(counter, { last: number })
    tx.set(ref, {
      number,
      kind,
      supplierId: input.supplier.id,
      supplierName: input.supplier.name,
      status: requested ? 'solicitado' : 'borrador',
      shortClosed: false,
      items,
      estTotal: estTotalOf(Object.values(items)),
      receivedTotal: 0,
      paidTotal: 0,
      paymentStatus: 'pendiente',
      expectedDate: kind === 'directa' ? null : input.expectedDate,
      notes: input.notes.trim(),
      lastReceptionId: null,
      lastPaymentId: null,
      createdAt: serverTimestamp(),
      requestedAt: requested ? serverTimestamp() : null,
      closedAt: null,
      updatedAt: serverTimestamp(),
    })
    addAudit(db, tx, uid, {
      action: kind === 'directa' ? 'crear_compra' : 'crear_pedido',
      entity: 'purchase',
      entityId: orderId,
      summary: `${kind === 'directa' ? 'Compra directa' : requested ? 'Pedido registrado' : 'Pedido en borrador'} #${number} a ${input.supplier.name}`,
    })
    return number
  })
}

/** Edita un borrador (proveedor, líneas, fecha y notas). */
export async function updateDraft(uid: string, orderId: string, input: OrderInput) {
  const error = validateLines(input.lines)
  if (error) throw new PurchaseError(error)
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'purchaseOrders', orderId)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PurchaseError('El pedido no existe.')
    const order = purchaseOrderFromDoc(snap.id, snap.data())
    if (order.status !== 'borrador') throw new PurchaseError('Solo se edita un borrador.')
    const items = itemsMap(input.lines, order.lines)
    tx.update(ref, {
      supplierId: input.supplier.id,
      supplierName: input.supplier.name,
      items,
      estTotal: estTotalOf(Object.values(items)),
      expectedDate: input.expectedDate,
      notes: input.notes.trim(),
      updatedAt: serverTimestamp(),
    })
    addAudit(db, tx, uid, {
      action: 'editar_pedido',
      entity: 'purchase',
      entityId: orderId,
      summary: `Pedido #${order.number} editado`,
    })
  })
}

/** Borrador → solicitado (al enviarlo al proveedor). */
export async function markRequested(uid: string, orderId: string) {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'purchaseOrders', orderId)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PurchaseError('El pedido no existe.')
    if (snap.data().status !== 'borrador') return
    tx.update(ref, {
      status: 'solicitado',
      requestedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    addAudit(db, tx, uid, {
      action: 'solicitar_pedido',
      entity: 'purchase',
      entityId: orderId,
      summary: `Pedido #${snap.data().number} registrado como solicitado`,
    })
  })
}

/** Cancela un pedido sin nada recibido (R-COM-01). */
export async function cancelPurchaseOrder(uid: string, orderId: string, reason: string) {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'purchaseOrders', orderId)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PurchaseError('El pedido no existe.')
    const order = purchaseOrderFromDoc(snap.id, snap.data())
    if (!['borrador', 'solicitado'].includes(order.status) || order.receivedTotal > 0) {
      throw new PurchaseError('Este pedido ya tiene mercancía recibida: ciérralo con faltante.')
    }
    tx.update(ref, {
      status: 'cancelado',
      closedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    addAudit(db, tx, uid, {
      action: 'cancelar_pedido',
      entity: 'purchase',
      entityId: orderId,
      summary: `Pedido #${order.number} cancelado`,
      reason,
    })
  })
}

/** Un pedido recibido en parte se cierra "con faltante": lo pendiente ya no llega (R-COM-01). */
export async function closeShort(uid: string, orderId: string, reason: string) {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'purchaseOrders', orderId)
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new PurchaseError('El pedido no existe.')
    const order = purchaseOrderFromDoc(snap.id, snap.data())
    if (order.status !== 'parcial') return
    tx.update(ref, {
      status: 'recibido',
      shortClosed: true,
      closedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    addAudit(db, tx, uid, {
      action: 'cerrar_faltante',
      entity: 'purchase',
      entityId: orderId,
      summary: `Pedido #${order.number} cerrado con faltante`,
      reason,
    })
  })
}

// ---------------------------------------------------------------------------
// Recepción (F7-03, R-COM-02…04)
// ---------------------------------------------------------------------------

/**
 * Registra lo que llegó. Cada grupo de RECEPTION_CHUNK líneas es una recepción inmutable con ID
 * `{opId}-{n}`: si se reintenta, los grupos ya guardados no se repiten.
 */
export async function receivePurchase(
  uid: string,
  orderId: string,
  opId: string,
  plan: ReceptionPlan,
  notes: string,
) {
  const groups = chunk(plan.lines, RECEPTION_CHUNK)
  for (const [n, lines] of groups.entries()) {
    const receptionId = `${opId}-${n + 1}`
    await runTransaction(db, async (tx) => {
      const orderRef = doc(db, 'purchaseOrders', orderId)
      const receptionRef = doc(db, 'receptions', receptionId)
      const [orderSnap, receptionSnap, ...productSnaps] = await Promise.all([
        tx.get(orderRef),
        tx.get(receptionRef),
        ...lines.map((l) => tx.get(doc(db, 'products', l.productId))),
      ])
      if (receptionSnap.exists()) return // ya quedó registrada
      if (!orderSnap.exists()) throw new PurchaseError('El pedido no existe.')
      const order = purchaseOrderFromDoc(orderSnap.id, orderSnap.data())
      if (!RECEIVABLE.includes(order.status) || order.shortClosed) {
        throw new PurchaseError('Este pedido ya no recibe mercancía.')
      }
      const supplierRef = doc(db, 'suppliers', order.supplierId)
      const total = lines.reduce((s, l) => s + l.qty * l.unitCost, 0)
      const businessDate = businessDateOf(new Date())

      // Inventario: producto + movimiento `rec_{recepción}_{línea}` por cada línea (D-215).
      lines.forEach((l, i) => {
        const productSnap = productSnaps[i] as DocumentSnapshot
        if (!productSnap.exists()) throw new PurchaseError(`"${l.name}" ya no existe.`)
        const p = productSnap.data()!
        const result = applyMovement(
          { stock: Number(p.stock ?? 0), avgCost: Number(p.avgCost ?? 0) },
          { type: 'entrada_compra', quantity: l.qty, unitCost: l.unitCost },
        )
        writeMovement(
          tx,
          uid,
          `rec_${receptionId}_${l.lineId}`,
          productSnap,
          'entrada_compra',
          result,
          null,
          {
            type: 'compra',
            id: receptionId,
            supplierId: order.supplierId,
          },
        )
      })

      const received = new Map(lines.map((l) => [l.lineId, l.qty]))
      const after = order.lines.map((l) => ({
        ...l,
        qtyReceived: l.qtyReceived + (received.get(l.lineId) ?? 0),
      }))
      const receivedTotal = order.receivedTotal + total
      const status = statusAfterReception(after)
      tx.set(receptionRef, {
        purchaseOrderId: orderId,
        supplierId: order.supplierId,
        lines: Object.fromEntries(
          lines.map((l) => [
            l.lineId,
            { productId: l.productId, qty: l.qty, unitCost: l.unitCost },
          ]),
        ),
        total,
        businessDate,
        notes: notes.trim(),
        uid,
        createdAt: serverTimestamp(),
      })
      tx.update(orderRef, {
        ...Object.fromEntries(
          lines.map((l) => [
            `items.${l.lineId}.qtyReceived`,
            after.find((a) => a.lineId === l.lineId)!.qtyReceived,
          ]),
        ),
        receivedTotal,
        paymentStatus: paymentStatusOf(receivedTotal, order.paidTotal),
        status,
        lastReceptionId: receptionId,
        ...(status === 'recibido' ? { closedAt: serverTimestamp() } : {}),
        updatedAt: serverTimestamp(),
      })
      // D-223 #8: último costo de este proveedor por producto.
      tx.update(supplierRef, {
        ...Object.fromEntries(lines.map((l) => [`lastCosts.${l.productId}`, l.unitCost])),
        updatedAt: serverTimestamp(),
      })
      addDailyStats(db, tx, businessDate, purchaseStats(total))
      addAudit(db, tx, uid, {
        action: 'recibir_compra',
        entity: 'purchase',
        entityId: orderId,
        summary: `Pedido #${order.number}: recibido ${formatCop(total)} (${lines.length} productos)`,
      })
    })
  }
}

// ---------------------------------------------------------------------------
// Pagos a proveedores (F7-04, R-COM-05, D-223 #3/#4)
// ---------------------------------------------------------------------------

export interface SupplierPaymentInput {
  amount: number
  method: SupplierPayMethod
  channel: TransferChannel | null
  /** De la caja abierta (efectivo): se descuenta del arqueo. */
  fromCash: boolean
  notes: string
}

export interface SupplierPayment {
  id: string
  purchaseOrderId: string
  supplierId: string
  amount: number
  method: SupplierPayMethod
  channel: TransferChannel | null
  fromCash: boolean
  businessDate: string
  createdAt: Date | null
}

export function supplierPaymentFromDoc(id: string, x: Record<string, unknown>): SupplierPayment {
  return {
    id,
    purchaseOrderId: String(x.purchaseOrderId ?? ''),
    supplierId: String(x.supplierId ?? ''),
    amount: Number(x.amount ?? 0),
    method: (x.method as SupplierPayMethod) ?? 'efectivo',
    channel: (x.channel as TransferChannel | null) ?? null,
    fromCash: x.fromCash === true,
    businessDate: String(x.businessDate ?? ''),
    createdAt: toDate(x.createdAt),
  }
}

export function useSupplierPaymentsOfOrder(orderId: string | undefined) {
  return useSubscription<SupplierPayment[]>(
    (onData, onError) =>
      onSnapshot(
        query(collection(db, 'supplierPayments'), where('purchaseOrderId', '==', orderId ?? '-')),
        (snap) =>
          onData(
            snap.docs
              .map((d) => supplierPaymentFromDoc(d.id, d.data()))
              .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0)),
          ),
        onError,
      ),
    `supplierPayments/${orderId ?? ''}`,
  )
}

/** Paga (todo o una parte) lo recibido de un pedido. `paymentId` se genera antes (D-203). */
export async function registerSupplierPayment(
  uid: string,
  orderId: string,
  paymentId: string,
  input: SupplierPaymentInput,
) {
  await runTransaction(db, async (tx) => {
    const orderRef = doc(db, 'purchaseOrders', orderId)
    const payRef = doc(db, 'supplierPayments', paymentId)
    const countersRef = doc(db, 'counters', 'cashSessions')
    const [orderSnap, paySnap, counters] = await Promise.all([
      tx.get(orderRef),
      tx.get(payRef),
      tx.get(countersRef),
    ])
    if (paySnap.exists()) return
    if (!orderSnap.exists()) throw new PurchaseError('El pedido no existe.')
    const order = purchaseOrderFromDoc(orderSnap.id, orderSnap.data())
    const error = validateSupplierPayment(input.amount, order.receivedTotal - order.paidTotal)
    if (error) throw new PurchaseError(error)

    let sessionId: string | null = null
    let businessDate = businessDateOf(new Date())
    if (input.fromCash) {
      if (input.method !== 'efectivo') throw new PurchaseError('De la caja solo sale efectivo.')
      sessionId = (counters.data()?.openSessionId as string | null) ?? null
      if (!sessionId) throw new PurchaseError('Abre la caja para pagar con su efectivo.')
      const session = await tx.get(doc(db, 'cashSessions', sessionId))
      businessDate = String(session.data()?.businessDate ?? businessDate)
    }

    const paidTotal = order.paidTotal + input.amount
    tx.set(payRef, {
      purchaseOrderId: orderId,
      supplierId: order.supplierId,
      amount: input.amount,
      method: input.method,
      channel: input.method === 'transferencia' ? (input.channel ?? 'otro') : null,
      fromCash: input.fromCash,
      cashSessionId: sessionId,
      businessDate,
      notes: input.notes.trim(),
      uid,
      createdAt: serverTimestamp(),
    })
    tx.update(orderRef, {
      paidTotal,
      paymentStatus: paymentStatusOf(order.receivedTotal, paidTotal),
      lastPaymentId: paymentId,
      updatedAt: serverTimestamp(),
    })
    if (input.fromCash && sessionId) {
      tx.set(doc(db, 'cashMovements', `sp-${paymentId}`), {
        sessionId,
        businessDate,
        type: 'pago_proveedor',
        amount: -input.amount,
        reason: `Pago a ${order.supplierName}, pedido #${order.number}`,
        refType: 'supplierPayment',
        refId: paymentId,
        uid,
        createdAt: serverTimestamp(),
      })
    }
    addDailyStats(db, tx, businessDate, supplierPaymentStats(input.amount, input.fromCash))
    addAudit(db, tx, uid, {
      action: 'pagar_proveedor',
      entity: 'purchase',
      entityId: orderId,
      summary: `Pago de ${formatCop(input.amount)} a ${order.supplierName} (pedido #${order.number})${input.fromCash ? ', de la caja' : ''}`,
    })
  })
}
