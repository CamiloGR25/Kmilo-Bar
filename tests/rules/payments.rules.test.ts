/** Reglas de la Fase 5: pagos, movimientos y cierre de caja, agregados (R-PAG-01…07, D-219). */
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  deleteDoc,
  doc,
  FieldPath,
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

const T0 = Timestamp.fromDate(new Date('2026-11-05T22:00:00-05:00'))
const DAY = '2026-11-05'

const session = (over = {}) => ({
  number: 1,
  businessDate: DAY,
  status: 'abierta',
  openingBalance: 100000,
  openedAt: T0,
  openedBy: ADMIN_UID,
  closedAt: null,
  ...over,
})

const line = {
  productId: 'p1',
  nameSnap: 'Águila',
  categoryIdSnap: 'cervezas',
  unitPrice: 4500,
  unitCostSnap: 2400,
  qty: 3,
  cancelledQty: 0,
  lostQty: 0,
  lastCancelId: null,
  addedAt: T0,
}

/** Cuenta de $13.500 en la mesa 1, con caja cs1 abierta. */
async function seedOrder(over: Record<string, unknown> = {}) {
  await seed(async (db) => {
    await setDoc(doc(db, 'counters/cashSessions'), { last: 1, openSessionId: 'cs1' })
    await setDoc(doc(db, 'cashSessions/cs1'), session())
    await setDoc(doc(db, 'tables/mesa-1'), {
      name: 'Mesa 1',
      number: 1,
      status: 'ocupada',
      currentOrderId: 'o1',
      active: true,
      sortOrder: 1,
    })
    await setDoc(doc(db, 'orders/o1'), {
      number: 1,
      type: 'mesa',
      tableId: 'mesa-1',
      tableName: 'Mesa 1',
      label: null,
      status: 'abierta',
      cashSessionId: 'cs1',
      businessDate: DAY,
      items: { l1: line },
      lastLineId: 'l1',
      subtotal: 13500,
      total: 13500,
      paidTotal: 0,
      tipTotal: 0,
      balance: 13500,
      uid: ADMIN_UID,
      openedAt: T0,
      closedAt: null,
      updatedAt: T0,
      ...over,
    })
  })
}

const cashPayment = (over = {}) => ({
  orderId: 'o1',
  cashSessionId: 'cs1',
  businessDate: DAY,
  method: 'efectivo',
  channel: null,
  amount: 13500,
  tendered: 20000,
  change: 6500,
  reference: null,
  kind: 'pago',
  uid: ADMIN_UID,
  createdAt: serverTimestamp(),
  correctedAt: null,
  correctedFrom: null,
  ...over,
})

/** Pago completo: pago + cuenta pagada + mesa libre + agregados. */
function payAll(db: Firestore, payment = cashPayment(), orderOver = {}) {
  const b = writeBatch(db)
  b.set(doc(db, 'payments/pay1'), payment)
  b.update(doc(db, 'orders/o1'), {
    paidTotal: 13500,
    balance: 0,
    lastPaymentId: 'pay1',
    status: 'pagada',
    closedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...orderOver,
  })
  b.update(doc(db, 'tables/mesa-1'), { status: 'disponible', currentOrderId: null })
  b.set(
    doc(db, `dailyStats/${DAY}`),
    {
      businessDate: DAY,
      salesGross: increment(13500),
      cogs: increment(7200),
      ordersCount: increment(1),
      collected: increment(13500),
      byMethod: { efectivo: increment(13500) },
      byProduct: { p1: { name: 'Águila', categoryId: 'cervezas', qty: increment(3) } },
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
  return b.commit()
}

/** Pago parcial por transferencia: la cuenta sigue abierta. */
function payPart(db: Firestore, amount: number, over = {}) {
  const b = writeBatch(db)
  b.set(
    doc(db, 'payments/pay1'),
    cashPayment({
      method: 'transferencia',
      channel: 'nequi',
      amount,
      tendered: null,
      change: 0,
      reference: 'M123',
      ...over,
    }),
  )
  b.update(doc(db, 'orders/o1'), {
    paidTotal: amount,
    balance: 13500 - amount,
    lastPaymentId: 'pay1',
    updatedAt: serverTimestamp(),
  })
  return b.commit()
}

describe('pagos (R-PAG-02, R-VEN-08)', () => {
  it('pago total en efectivo con cambio: la cuenta queda pagada y la mesa libre', async () => {
    await seedOrder()
    await assertSucceeds(payAll(admin()))
  })

  it('pago parcial por transferencia: la cuenta sigue abierta', async () => {
    await seedOrder()
    await assertSucceeds(payPart(admin(), 5000))
  })

  it('no acepta un pago sin la cuenta que lo refleje', async () => {
    await seedOrder()
    await assertFails(setDoc(doc(admin(), 'payments/pay1'), cashPayment()))
  })

  it('el monto del pago debe cuadrar con lo pagado de la cuenta', async () => {
    await seedOrder()
    await assertFails(payAll(admin(), cashPayment({ amount: 10000, change: 10000 })))
  })

  it('no se cobra de más por transferencia (saldo negativo)', async () => {
    await seedOrder()
    const db = admin()
    const b = writeBatch(db)
    b.set(
      doc(db, 'payments/pay1'),
      cashPayment({
        method: 'transferencia',
        channel: 'nequi',
        amount: 15000,
        tendered: null,
        change: 0,
      }),
    )
    b.update(doc(db, 'orders/o1'), {
      paidTotal: 15000,
      balance: -1500,
      lastPaymentId: 'pay1',
      updatedAt: serverTimestamp(),
    })
    await assertFails(b.commit())
  })

  it('efectivo: el cambio debe ser recibido − abonado', async () => {
    await seedOrder()
    await assertFails(payAll(admin(), cashPayment({ change: 5000 })))
  })

  it('transferencia exige canal válido', async () => {
    await seedOrder()
    await assertFails(payPart(admin(), 5000, { channel: 'tarjeta' }))
  })

  it('no se marca pagada con saldo pendiente (sin fiado)', async () => {
    await seedOrder()
    const db = admin()
    const b = writeBatch(db)
    b.set(doc(db, 'payments/pay1'), cashPayment({ amount: 5000, tendered: 5000, change: 0 }))
    b.update(doc(db, 'orders/o1'), {
      paidTotal: 5000,
      balance: 8500,
      lastPaymentId: 'pay1',
      status: 'pagada',
      closedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    b.update(doc(db, 'tables/mesa-1'), { status: 'disponible', currentOrderId: null })
    await assertFails(b.commit())
  })

  it('no se cobra si la caja de la cuenta no está abierta', async () => {
    await seedOrder()
    await seed(async (db) => {
      await setDoc(doc(db, 'counters/cashSessions'), { last: 2, openSessionId: 'cs2' })
    })
    await assertFails(payAll(admin()))
  })

  it('una cuenta pagada no se modifica', async () => {
    await seedOrder({
      status: 'pagada',
      paidTotal: 13500,
      balance: 0,
      closedAt: T0,
      lastPaymentId: 'pay0',
    })
    await assertFails(
      updateDoc(doc(admin(), 'orders/o1'), { status: 'abierta', updatedAt: serverTimestamp() }),
    )
  })

  it('sin reembolsos: no se cancela por debajo de lo pagado', async () => {
    await seedOrder({ paidTotal: 9000, balance: 4500, lastPaymentId: 'pay0' })
    const db = admin()
    const p = (f: string) => new FieldPath('items', 'l1', f)
    await assertFails(
      updateDoc(
        doc(db, 'orders/o1'),
        p('lostQty'),
        2,
        p('lastCancelId'),
        'c1',
        'subtotal',
        4500,
        'total',
        4500,
        'balance',
        -4500,
        'updatedAt',
        serverTimestamp(),
      ),
    )
    // Una unidad sí (queda saldo 0).
    await assertSucceeds(
      updateDoc(
        doc(db, 'orders/o1'),
        p('lostQty'),
        1,
        p('lastCancelId'),
        'c1',
        'subtotal',
        9000,
        'total',
        9000,
        'balance',
        0,
        'updatedAt',
        serverTimestamp(),
      ),
    )
  })
})

describe('corrección del medio de pago (D-219)', () => {
  async function seedPaid() {
    await seedOrder({
      status: 'pagada',
      paidTotal: 13500,
      balance: 0,
      closedAt: T0,
      lastPaymentId: 'pay1',
    })
    await seed(async (db) => {
      await setDoc(doc(db, 'payments/pay1'), cashPayment({ createdAt: T0 }))
    })
  }

  it('cambia el medio, nunca el monto, y guarda de dónde venía', async () => {
    await seedPaid()
    const ref = doc(admin(), 'payments/pay1')
    await assertSucceeds(
      updateDoc(ref, {
        method: 'transferencia',
        channel: 'nequi',
        tendered: null,
        change: 0,
        correctedAt: serverTimestamp(),
        correctedFrom: { method: 'efectivo', channel: null },
      }),
    )
    await assertFails(updateDoc(ref, { amount: 1000 }))
    await assertFails(deleteDoc(ref))
  })

  it('no se corrige con la caja cerrada', async () => {
    await seedPaid()
    await seed(async (db) => {
      await setDoc(doc(db, 'counters/cashSessions'), { last: 1, openSessionId: null })
    })
    await assertFails(
      updateDoc(doc(admin(), 'payments/pay1'), {
        method: 'transferencia',
        channel: 'nequi',
        tendered: null,
        change: 0,
        correctedAt: serverTimestamp(),
        correctedFrom: { method: 'efectivo', channel: null },
      }),
    )
  })
})

describe('movimientos de caja (R-PAG-05)', () => {
  const movement = (over = {}) => ({
    sessionId: 'cs1',
    businessDate: DAY,
    type: 'retiro_dueno',
    amount: -30000,
    reason: 'Retiro parcial',
    refType: null,
    refId: null,
    uid: ADMIN_UID,
    createdAt: serverTimestamp(),
    ...over,
  })

  it('registra entradas y salidas con motivo en la caja abierta', async () => {
    await seedOrder()
    const db = admin()
    await assertSucceeds(setDoc(doc(db, 'cashMovements/m1'), movement()))
    await assertSucceeds(
      setDoc(doc(db, 'cashMovements/m2'), movement({ type: 'entrada_extra', amount: 50000 })),
    )
    await assertFails(updateDoc(doc(db, 'cashMovements/m1'), { amount: -1 }))
  })

  it('valida signo, motivo y caja', async () => {
    await seedOrder()
    const db = admin()
    await assertFails(setDoc(doc(db, 'cashMovements/m1'), movement({ amount: 30000 })))
    await assertFails(setDoc(doc(db, 'cashMovements/m1'), movement({ reason: '' })))
    await assertFails(setDoc(doc(db, 'cashMovements/m1'), movement({ type: 'gasto' })))
    await assertFails(setDoc(doc(db, 'cashMovements/m1'), movement({ sessionId: 'cs0' })))
  })
})

describe('cierre de caja (R-PAG-06)', () => {
  const closing = (over = {}) => ({
    status: 'cerrada',
    closedAt: serverTimestamp(),
    closedBy: ADMIN_UID,
    expectedCash: 113500,
    countedCash: 113000,
    difference: -500,
    differenceReason: 'Faltó una moneda',
    summary: { sales: 13500, ordersPaid: 1 },
    ...over,
  })

  function close(db: Firestore, over = {}) {
    const b = writeBatch(db)
    b.update(doc(db, 'cashSessions/cs1'), closing(over))
    b.update(doc(db, 'counters/cashSessions'), { openSessionId: null })
    return b.commit()
  }

  it('cierra con conteo y motivo de la diferencia', async () => {
    await seedOrder()
    await assertSucceeds(close(admin()))
  })

  it('exige motivo si hay diferencia y que la diferencia cuadre', async () => {
    await seedOrder()
    await assertFails(close(admin(), { differenceReason: null }))
    await assertFails(close(admin(), { difference: 0, differenceReason: null }))
  })

  it('cierre sin diferencia no lleva motivo', async () => {
    await seedOrder()
    await assertSucceeds(
      close(admin(), { countedCash: 113500, difference: 0, differenceReason: null }),
    )
  })

  it('el contador no se libera sin cerrar la caja, y una caja cerrada no se toca', async () => {
    await seedOrder()
    await assertFails(updateDoc(doc(admin(), 'counters/cashSessions'), { openSessionId: null }))
    await seed(async (db) => {
      await setDoc(doc(db, 'cashSessions/cs1'), session({ status: 'cerrada', closedAt: T0 }))
      await setDoc(doc(db, 'counters/cashSessions'), { last: 1, openSessionId: null })
    })
    await assertFails(updateDoc(doc(admin(), 'cashSessions/cs1'), { countedCash: 1 }))
  })
})

describe('agregados diarios (D-204)', () => {
  it('no admiten ventas negativas ni campos extraños', async () => {
    await seedOrder()
    const ref = doc(admin(), `dailyStats/${DAY}`)
    await assertFails(
      setDoc(ref, { businessDate: DAY, salesGross: -1, updatedAt: serverTimestamp() }),
    )
    await assertFails(setDoc(ref, { businessDate: DAY, hack: 1, updatedAt: serverTimestamp() }))
    await assertFails(
      setDoc(doc(admin(), 'dailyStats/2026-11-06'), {
        businessDate: DAY,
        updatedAt: serverTimestamp(),
      }),
    )
    await assertSucceeds(
      setDoc(ref, { businessDate: DAY, salesGross: 100, updatedAt: serverTimestamp() }),
    )
  })
})
