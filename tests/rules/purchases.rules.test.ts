/** Reglas de la Fase 7: proveedores, pedidos, recepciones y pagos (R-COM-01…05, D-223). */
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  doc,
  increment,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { ADMIN_UID, createEnv } from './helpers.ts'

let env: RulesTestEnvironment
beforeAll(async () => {
  env = await createEnv()
})
beforeEach(async () => {
  await env.clearFirestore()
})
afterAll(async () => {
  await env?.cleanup()
})

const admin = () => env.authenticatedContext(ADMIN_UID).firestore() as unknown as Firestore
const seed = (fn: (db: Firestore) => Promise<void>) =>
  env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore() as unknown as Firestore))

const T0 = Timestamp.fromDate(new Date('2026-11-09T10:00:00-05:00'))
const DAY = '2026-11-09'

const product = (stock = 0) => ({
  name: 'Águila',
  description: '',
  categoryId: 'cervezas',
  unit: 'botella',
  stock,
  minStock: 24,
  avgCost: 2400,
  lastPurchaseCost: 2400,
  salePrice: 4500,
  pricingMode: 'auto',
  markupBp: null,
  active: true,
  supplierId: 's1',
  purchaseUnit: 'Canasta',
  unitsPerPurchase: 30,
  createdAt: T0,
  updatedAt: T0,
})

const supplier = () => ({
  name: 'Distribuidora',
  contactName: '',
  phone: '',
  notes: '',
  active: true,
  lastCosts: {},
  createdAt: T0,
  updatedAt: T0,
})

const purchase = (over: Record<string, unknown> = {}) => ({
  number: 1,
  kind: 'pedido',
  supplierId: 's1',
  supplierName: 'Distribuidora',
  status: 'solicitado',
  shortClosed: false,
  items: {
    l1: {
      productId: 'aguila',
      nameSnap: 'Águila',
      qtyOrdered: 20,
      qtyReceived: 0,
      estUnitCost: 2400,
      addedAt: 1,
    },
  },
  estTotal: 48000,
  receivedTotal: 0,
  paidTotal: 0,
  paymentStatus: 'pendiente',
  expectedDate: null,
  notes: '',
  lastReceptionId: null,
  lastPaymentId: null,
  createdAt: T0,
  requestedAt: T0,
  closedAt: null,
  updatedAt: T0,
  ...over,
})

async function seedBase(order: Record<string, unknown> | null = purchase(), cashOpen = false) {
  await seed(async (db) => {
    await setDoc(doc(db, 'products/aguila'), product(0))
    await setDoc(doc(db, 'suppliers/s1'), supplier())
    await setDoc(doc(db, 'counters/purchaseOrders'), { last: order ? 1 : 0 })
    await setDoc(doc(db, 'counters/cashSessions'), {
      last: 1,
      openSessionId: cashOpen ? 'cs1' : null,
    })
    if (cashOpen) {
      await setDoc(doc(db, 'cashSessions/cs1'), {
        number: 1,
        businessDate: DAY,
        status: 'abierta',
        openingBalance: 200000,
        openedAt: T0,
        openedBy: ADMIN_UID,
        closedAt: null,
      })
    }
    if (order) await setDoc(doc(db, 'purchaseOrders/o1'), order)
  })
}

/** Recepción completa como la hace el servicio: 15 unidades a $ 2.500. */
function receive(
  db: Firestore,
  over: { total?: number; qty?: number; skipMovement?: boolean } = {},
) {
  const qty = over.qty ?? 15
  const total = over.total ?? qty * 2500
  const b = writeBatch(db)
  const rec = 'r1-1'
  const movId = `rec_${rec}_l1`
  if (!over.skipMovement) {
    b.update(doc(db, 'products/aguila'), {
      stock: qty,
      avgCost: 2500,
      lastPurchaseCost: 2500,
      lastMovementId: movId,
      updatedAt: serverTimestamp(),
    })
    b.set(doc(db, 'inventoryMovements', movId), {
      productId: 'aguila',
      productName: 'Águila',
      type: 'entrada_compra',
      qty,
      stockBefore: 0,
      stockAfter: qty,
      avgCostBefore: 2400,
      avgCostAfter: 2500,
      unitCost: 2500,
      sourceType: 'compra',
      sourceId: rec,
      supplierId: 's1',
      reason: null,
      businessDate: DAY,
      uid: ADMIN_UID,
      createdAt: serverTimestamp(),
    })
    b.set(doc(db, 'priceHistory/ph1'), {
      productId: 'aguila',
      field: 'avgCost',
      oldValue: 2400,
      newValue: 2500,
      source: 'recepcion',
      reason: null,
      at: serverTimestamp(),
    })
  }
  b.set(doc(db, 'receptions', rec), {
    purchaseOrderId: 'o1',
    supplierId: 's1',
    lines: { l1: { productId: 'aguila', qty, unitCost: 2500 } },
    total,
    businessDate: DAY,
    notes: '',
    uid: ADMIN_UID,
    createdAt: serverTimestamp(),
  })
  b.update(doc(db, 'purchaseOrders/o1'), {
    'items.l1.qtyReceived': qty,
    receivedTotal: total,
    paymentStatus: 'pendiente',
    status: qty >= 20 ? 'recibido' : 'parcial',
    lastReceptionId: rec,
    updatedAt: serverTimestamp(),
  })
  b.update(doc(db, 'suppliers/s1'), { 'lastCosts.aguila': 2500, updatedAt: serverTimestamp() })
  b.set(
    doc(db, `dailyStats/${DAY}`),
    { businessDate: DAY, purchases: increment(total), updatedAt: serverTimestamp() },
    { merge: true },
  )
  return b.commit()
}

describe('proveedores (F7-01)', () => {
  it('crea y edita con datos válidos', async () => {
    await seedBase(null)
    const db = admin()
    await assertSucceeds(
      setDoc(doc(db, 'suppliers/s2'), { ...supplier(), updatedAt: serverTimestamp() }),
    )
    await assertSucceeds(
      updateDoc(doc(db, 'suppliers/s2'), { phone: '3001234567', updatedAt: serverTimestamp() }),
    )
    await assertFails(
      setDoc(doc(db, 'suppliers/s3'), { ...supplier(), name: 'X', updatedAt: serverTimestamp() }),
    )
    await assertFails(
      setDoc(doc(db, 'suppliers/s4'), { ...supplier(), otro: 1, updatedAt: serverTimestamp() }),
    )
  })

  it('el producto acepta proveedor y unidad de compra completos', async () => {
    await seedBase(null)
    const db = admin()
    await assertSucceeds(
      updateDoc(doc(db, 'products/aguila'), { purchaseUnit: 'Paca', unitsPerPurchase: 24 }),
    )
    await assertFails(
      updateDoc(doc(db, 'products/aguila'), { purchaseUnit: null, unitsPerPurchase: 24 }),
    )
    await assertFails(updateDoc(doc(db, 'products/aguila'), { unitsPerPurchase: 1 }))
  })
})

describe('pedidos (R-COM-01)', () => {
  it('crea un borrador con el consecutivo', async () => {
    await seedBase(null)
    const db = admin()
    const b = writeBatch(db)
    b.update(doc(db, 'counters/purchaseOrders'), { last: 1 })
    b.set(doc(db, 'purchaseOrders/o1'), {
      ...purchase({ status: 'borrador', requestedAt: null }),
      updatedAt: serverTimestamp(),
    })
    await assertSucceeds(b.commit())
  })

  it('no crea un pedido con un número que no cuadra o ya recibido', async () => {
    await seedBase(null)
    const db = admin()
    const b = writeBatch(db)
    b.update(doc(db, 'counters/purchaseOrders'), { last: 1 })
    b.set(doc(db, 'purchaseOrders/o1'), {
      ...purchase({ number: 5 }),
      updatedAt: serverTimestamp(),
    })
    await assertFails(b.commit())
    const c = writeBatch(db)
    c.update(doc(db, 'counters/purchaseOrders'), { last: 1 })
    c.set(doc(db, 'purchaseOrders/o1'), {
      ...purchase({ receivedTotal: 100 }),
      updatedAt: serverTimestamp(),
    })
    await assertFails(c.commit())
  })

  it('cancela un pedido solicitado sin nada recibido', async () => {
    await seedBase()
    await assertSucceeds(
      updateDoc(doc(admin(), 'purchaseOrders/o1'), {
        status: 'cancelado',
        closedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    )
  })

  it('no sube lo recibido sin una recepción', async () => {
    await seedBase()
    await assertFails(
      updateDoc(doc(admin(), 'purchaseOrders/o1'), {
        receivedTotal: 10000,
        status: 'parcial',
        updatedAt: serverTimestamp(),
      }),
    )
  })
})

describe('recepción (R-COM-02)', () => {
  it('recibe 15 de 20: stock, costo, recepción, pedido, proveedor y estadísticas', async () => {
    await seedBase()
    await assertSucceeds(receive(admin()))
  })

  it('el total del pedido debe cuadrar con la recepción', async () => {
    await seedBase()
    const db = admin()
    const b = writeBatch(db)
    b.set(doc(db, 'receptions/r1-1'), {
      purchaseOrderId: 'o1',
      supplierId: 's1',
      lines: { l1: { productId: 'aguila', qty: 15, unitCost: 2500 } },
      total: 37500,
      businessDate: DAY,
      notes: '',
      uid: ADMIN_UID,
      createdAt: serverTimestamp(),
    })
    b.update(doc(db, 'purchaseOrders/o1'), {
      receivedTotal: 99999,
      status: 'parcial',
      lastReceptionId: 'r1-1',
      updatedAt: serverTimestamp(),
    })
    await assertFails(b.commit())
  })

  it('una entrada de compra sin recepción no pasa', async () => {
    await seedBase()
    const db = admin()
    const b = writeBatch(db)
    b.update(doc(db, 'products/aguila'), {
      stock: 10,
      lastMovementId: 'adj_x',
      updatedAt: serverTimestamp(),
    })
    b.set(doc(db, 'inventoryMovements/adj_x'), {
      productId: 'aguila',
      productName: 'Águila',
      type: 'entrada_compra',
      qty: 10,
      stockBefore: 0,
      stockAfter: 10,
      avgCostBefore: 2400,
      avgCostAfter: 2400,
      unitCost: 2400,
      sourceType: 'ajuste',
      sourceId: 'x',
      reason: null,
      businessDate: DAY,
      uid: ADMIN_UID,
      createdAt: serverTimestamp(),
    })
    await assertFails(b.commit())
  })

  it('un pedido cerrado con faltante ya no recibe', async () => {
    await seedBase(purchase({ status: 'recibido', shortClosed: true }))
    await assertFails(receive(admin()))
  })

  it('las recepciones no se editan', async () => {
    await seedBase()
    await receive(admin())
    await assertFails(updateDoc(doc(admin(), 'receptions/r1-1'), { total: 1 }))
  })
})

describe('pagos a proveedores (R-COM-05, D-223 #4)', () => {
  const received = purchase({ status: 'parcial', receivedTotal: 37500, lastReceptionId: 'r0' })

  function pay(db: Firestore, amount: number, fromCash: boolean, withCashMove = fromCash) {
    const b = writeBatch(db)
    b.set(doc(db, 'supplierPayments/p1'), {
      purchaseOrderId: 'o1',
      supplierId: 's1',
      amount,
      method: 'efectivo',
      channel: null,
      fromCash,
      cashSessionId: fromCash ? 'cs1' : null,
      businessDate: DAY,
      notes: '',
      uid: ADMIN_UID,
      createdAt: serverTimestamp(),
    })
    b.update(doc(db, 'purchaseOrders/o1'), {
      paidTotal: amount,
      paymentStatus: amount === 37500 ? 'pagado' : 'abonado',
      lastPaymentId: 'p1',
      updatedAt: serverTimestamp(),
    })
    if (withCashMove) {
      b.set(doc(db, 'cashMovements/sp-p1'), {
        sessionId: 'cs1',
        businessDate: DAY,
        type: 'pago_proveedor',
        amount: -amount,
        reason: 'Pago a Distribuidora, pedido #1',
        refType: 'supplierPayment',
        refId: 'p1',
        uid: ADMIN_UID,
        createdAt: serverTimestamp(),
      })
    }
    return b.commit()
  }

  it('paga por fuera un abono', async () => {
    await seedBase(received)
    await assertSucceeds(pay(admin(), 20000, false))
  })

  it('paga de la caja con su salida de caja', async () => {
    await seedBase(received, true)
    await assertSucceeds(pay(admin(), 37500, true))
  })

  it('de la caja sin la salida de caja no pasa', async () => {
    await seedBase(received, true)
    await assertFails(pay(admin(), 37500, true, false))
  })

  it('de la caja sin caja abierta no pasa', async () => {
    await seedBase(received, false)
    await assertFails(pay(admin(), 37500, true))
  })

  it('no se paga más de lo recibido', async () => {
    await seedBase(received)
    await assertFails(pay(admin(), 40000, false))
  })

  it('una salida "pago a proveedor" suelta no pasa', async () => {
    await seedBase(received, true)
    await assertFails(
      setDoc(doc(admin(), 'cashMovements/m1'), {
        sessionId: 'cs1',
        businessDate: DAY,
        type: 'pago_proveedor',
        amount: -1000,
        reason: 'Pago',
        refType: null,
        refId: null,
        uid: ADMIN_UID,
        createdAt: serverTimestamp(),
      }),
    )
  })
})
