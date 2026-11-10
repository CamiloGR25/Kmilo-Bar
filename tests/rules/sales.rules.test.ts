/** Reglas de la Fase 4: caja, mesas y cuentas (D-110, R-VEN-03/05/06, R-PAG-07, D-217). */
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  doc,
  FieldPath,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  type Firestore,
  type WriteBatch,
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

const product = (stock: number, over = {}) => ({
  name: 'Águila',
  description: '',
  categoryId: 'cervezas',
  unit: 'botella',
  stock,
  minStock: 6,
  avgCost: 2400,
  lastPurchaseCost: 2400,
  salePrice: 4500,
  pricingMode: 'auto',
  markupBp: null,
  active: true,
  createdAt: T0,
  updatedAt: T0,
  ...over,
})

const table = (n: number, over = {}) => ({
  name: `Mesa ${n}`,
  number: n,
  status: 'disponible',
  currentOrderId: null,
  active: true,
  sortOrder: n,
  ...over,
})

const line = (over = {}) => ({
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
  roundId: 'r1',
  ...over,
})

const order = (over: Record<string, unknown> = {}) => {
  const subtotal = (over.subtotal as number | undefined) ?? 0
  return {
    number: 1,
    type: 'mesa',
    tableId: 'mesa-1',
    tableName: 'Mesa 1',
    label: null,
    status: 'abierta',
    cashSessionId: 'cs1',
    businessDate: '2026-11-05',
    items: {},
    lastLineId: null,
    rounds: {},
    subtotal,
    total: subtotal,
    paidTotal: 0,
    tipTotal: 0,
    balance: subtotal,
    uid: ADMIN_UID,
    openedAt: T0,
    closedAt: null,
    updatedAt: T0,
    ...over,
  }
}

/** Base: producto con stock 10, 2 mesas, contadores y (opcional) una caja abierta. */
async function seedBase({ cashOpen = true } = {}) {
  await seed(async (db) => {
    await setDoc(doc(db, 'products/p1'), product(10))
    await setDoc(doc(db, 'tables/mesa-1'), table(1))
    await setDoc(doc(db, 'tables/mesa-2'), table(2))
    await setDoc(doc(db, 'counters/orders'), { last: 0 })
    await setDoc(doc(db, 'counters/cashSessions'), {
      last: cashOpen ? 1 : 0,
      openSessionId: cashOpen ? 'cs1' : null,
    })
    if (cashOpen) {
      await setDoc(doc(db, 'cashSessions/cs1'), {
        number: 1,
        businessDate: '2026-11-05',
        status: 'abierta',
        openingBalance: 100000,
        openedAt: T0,
        openedBy: ADMIN_UID,
        closedAt: null,
      })
    }
  })
}

/** Cuenta abierta en la mesa 1 con una línea de 3 unidades (stock ya descontado: 7). */
async function seedOpenOrder(over: Record<string, unknown> = {}) {
  await seedBase()
  await seed(async (db) => {
    await setDoc(doc(db, 'products/p1'), product(7, { lastMovementId: 'sale_o1_l1' }))
    await setDoc(doc(db, 'counters/orders'), { last: 1 })
    await setDoc(doc(db, 'tables/mesa-1'), table(1, { status: 'ocupada', currentOrderId: 'o1' }))
    await setDoc(
      doc(db, 'orders/o1'),
      order({ items: { l1: line() }, lastLineId: 'l1', subtotal: 13500, ...over }),
    )
  })
}

function openOrderBatch(db: Firestore, b: WriteBatch, id: string, over = {}, tableId = 'mesa-1') {
  b.update(doc(db, 'counters/orders'), { last: 1 })
  b.set(
    doc(db, 'orders', id),
    order({
      tableId,
      tableName: tableId === 'mesa-1' ? 'Mesa 1' : 'Mesa 2',
      openedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...over,
    }),
  )
  if (tableId) b.update(doc(db, 'tables', tableId), { status: 'ocupada', currentOrderId: id })
}

/** Pareja producto + movimiento, como writeMovement. */
function stockMove(
  db: Firestore,
  b: WriteBatch,
  movId: string,
  type: string,
  qty: number,
  stockBefore: number,
  source = { type: 'venta', id: 'o1' },
) {
  b.update(doc(db, 'products/p1'), {
    stock: stockBefore + qty,
    avgCost: 2400,
    lastMovementId: movId,
    updatedAt: serverTimestamp(),
  })
  b.set(doc(db, 'inventoryMovements', movId), {
    productId: 'p1',
    productName: 'Águila',
    type,
    qty,
    stockBefore,
    stockAfter: stockBefore + qty,
    avgCostBefore: 2400,
    avgCostAfter: 2400,
    unitCost: 2400,
    sourceType: source.type,
    sourceId: source.id,
    reason: type === 'cancelacion_item' ? 'No la quiso' : null,
    businessDate: '2026-11-05',
    uid: ADMIN_UID,
    createdAt: serverTimestamp(),
  })
}

describe('caja (D-110, R-PAG-07)', () => {
  function openCash(db: Firestore, id: string, number: number) {
    const b = writeBatch(db)
    b.update(doc(db, 'counters/cashSessions'), { last: number, openSessionId: id })
    b.set(doc(db, 'cashSessions', id), {
      number,
      businessDate: '2026-11-05',
      status: 'abierta',
      openingBalance: 150000,
      openedAt: serverTimestamp(),
      openedBy: ADMIN_UID,
      closedAt: null,
    })
    return b.commit()
  }

  it('abre una caja si no hay otra abierta', async () => {
    await seedBase({ cashOpen: false })
    await assertSucceeds(openCash(admin(), 'cs1', 1))
  })

  it('no abre una segunda caja', async () => {
    await seedBase()
    await assertFails(openCash(admin(), 'cs2', 2))
  })

  it('las cajas no se editan desde el cliente en la Fase 4', async () => {
    await seedBase()
    await assertFails(updateDoc(doc(admin(), 'cashSessions/cs1'), { openingBalance: 1 }))
  })
})

describe('abrir cuenta (R-VEN-01, R-VEN-06)', () => {
  it('abre una cuenta de mesa con caja abierta', async () => {
    await seedBase()
    const db = admin()
    const b = writeBatch(db)
    openOrderBatch(db, b, 'o1')
    await assertSucceeds(b.commit())
  })

  it('sin caja abierta no se abre la cuenta', async () => {
    await seedBase({ cashOpen: false })
    const db = admin()
    const b = writeBatch(db)
    openOrderBatch(db, b, 'o1')
    await assertFails(b.commit())
  })

  it('una mesa ocupada no recibe otra cuenta', async () => {
    await seedOpenOrder()
    const db = admin()
    const b = writeBatch(db)
    b.update(doc(db, 'counters/orders'), { last: 2 })
    b.set(
      doc(db, 'orders/o2'),
      order({ number: 2, openedAt: serverTimestamp(), updatedAt: serverTimestamp() }),
    )
    b.update(doc(db, 'tables/mesa-1'), { currentOrderId: 'o2' })
    await assertFails(b.commit())
  })

  it('la cuenta de mesa debe ocupar la mesa en el mismo commit', async () => {
    await seedBase()
    const db = admin()
    const b = writeBatch(db)
    b.update(doc(db, 'counters/orders'), { last: 1 })
    b.set(
      doc(db, 'orders/o1'),
      order({ openedAt: serverTimestamp(), updatedAt: serverTimestamp() }),
    )
    await assertFails(b.commit())
  })

  it('varias cuentas de barra a la vez, con nombre', async () => {
    await seedBase()
    const db = admin()
    const b = writeBatch(db)
    openOrderBatch(
      db,
      b,
      'b1',
      { type: 'barra', tableId: null, tableName: null, label: 'Juan' },
      '',
    )
    await assertSucceeds(b.commit())
    const b2 = writeBatch(db)
    b2.update(doc(db, 'counters/orders'), { last: 2 })
    b2.set(
      doc(db, 'orders/b2'),
      order({
        number: 2,
        type: 'barra',
        tableId: null,
        tableName: null,
        openedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    )
    await assertSucceeds(b2.commit())
  })
})

describe('agregar líneas (R-VEN-03, D-101)', () => {
  function addLineBatch(db: Firestore, lineOver = {}, orderOver = {}, withMove = true) {
    const b = writeBatch(db)
    if (withMove) stockMove(db, b, 'sale_o1_l2', 'venta', -2, 7)
    b.update(
      doc(db, 'orders/o1'),
      new FieldPath('items', 'l2'),
      line({ qty: 2, addedAt: serverTimestamp(), ...lineOver }),
      'lastLineId',
      'l2',
      'subtotal',
      22500,
      'total',
      22500,
      'balance',
      22500,
      'status',
      'abierta',
      'updatedAt',
      serverTimestamp(),
      ...Object.entries(orderOver).flat(),
    )
    return b.commit()
  }

  it('línea + venta + producto en el mismo commit', async () => {
    await seedOpenOrder()
    await assertSucceeds(addLineBatch(admin()))
  })

  it('rechaza un precio distinto al del catálogo', async () => {
    await seedOpenOrder()
    await assertFails(addLineBatch(admin(), { unitPrice: 1000 }, { subtotal: 15500 }))
  })

  it('rechaza la línea sin su movimiento de venta', async () => {
    await seedOpenOrder()
    await assertFails(addLineBatch(admin(), {}, {}, false))
  })

  it('rechaza un subtotal que no cuadra', async () => {
    await seedOpenOrder()
    await assertFails(addLineBatch(admin(), {}, { subtotal: 99999, total: 99999, balance: 99999 }))
  })

  it('una venta sin línea en la cuenta no descuenta stock', async () => {
    await seedOpenOrder()
    const db = admin()
    const b = writeBatch(db)
    stockMove(db, b, 'sale_o1_l9', 'venta', -2, 7)
    await assertFails(b.commit())
  })

  it('una venta no puede registrarse como ajuste', async () => {
    await seedOpenOrder()
    const db = admin()
    const b = writeBatch(db)
    stockMove(db, b, 'adj_x', 'venta', -2, 7, { type: 'ajuste', id: 'x' })
    await assertFails(b.commit())
  })

  it('agregar a una cuenta por cobrar la reabre y la mesa vuelve a ocupada', async () => {
    await seedOpenOrder({ status: 'por_cobrar' })
    await seed(async (db) => {
      await updateDoc(doc(db, 'tables/mesa-1'), { status: 'por_cobrar' })
    })
    const db = admin()
    // Sin actualizar la mesa: falla.
    await assertFails(addLineBatch(db))
    const b = writeBatch(db)
    stockMove(db, b, 'sale_o1_l2', 'venta', -2, 7)
    b.update(
      doc(db, 'orders/o1'),
      new FieldPath('items', 'l2'),
      line({ qty: 2, addedAt: serverTimestamp() }),
      'lastLineId',
      'l2',
      'subtotal',
      22500,
      'total',
      22500,
      'balance',
      22500,
      'status',
      'abierta',
      'updatedAt',
      serverTimestamp(),
    )
    b.update(doc(db, 'tables/mesa-1'), { status: 'ocupada' })
    await assertSucceeds(b.commit())
  })
})

describe('cancelar (R-VEN-05, D-217)', () => {
  function cancelBatch(db: Firestore, delta: { c?: number; l?: number }, move: number | null) {
    const b = writeBatch(db)
    if (move !== null) stockMove(db, b, 'cancel_o1_l1_op1', 'cancelacion_item', move, 7)
    const units = (delta.c ?? 0) + (delta.l ?? 0)
    const subtotal = 13500 - 4500 * units
    b.update(
      doc(db, 'orders/o1'),
      new FieldPath('items', 'l1', 'cancelledQty'),
      delta.c ?? 0,
      new FieldPath('items', 'l1', 'lostQty'),
      delta.l ?? 0,
      new FieldPath('items', 'l1', 'lastCancelId'),
      'op1',
      'lastLineId',
      'l1',
      'subtotal',
      subtotal,
      'total',
      subtotal,
      'balance',
      subtotal,
      'updatedAt',
      serverTimestamp(),
    )
    return b.commit()
  }

  it('cancelación parcial no servida: devuelve al stock', async () => {
    await seedOpenOrder()
    await assertSucceeds(cancelBatch(admin(), { c: 1 }, 1))
  })

  it('la devolución debe coincidir con lo cancelado', async () => {
    await seedOpenOrder()
    await assertFails(cancelBatch(admin(), { c: 1 }, 2))
  })

  it('no se devuelve al stock sin movimiento', async () => {
    await seedOpenOrder()
    await assertFails(cancelBatch(admin(), { c: 1 }, null))
  })

  it('servido no cobrado: pérdida sin movimiento', async () => {
    await seedOpenOrder()
    await assertSucceeds(cancelBatch(admin(), { l: 2 }, null))
  })

  it('no se cancela más de lo que tiene la línea', async () => {
    await seedOpenOrder()
    await assertFails(cancelBatch(admin(), { l: 4 }, null))
  })
})

describe('mover, pedir cuenta y cerrar (R-VEN-02, R-VEN-06)', () => {
  it('pedir cuenta cambia la mesa a por cobrar', async () => {
    await seedOpenOrder()
    const db = admin()
    const bad = writeBatch(db)
    bad.update(doc(db, 'orders/o1'), { status: 'por_cobrar', updatedAt: serverTimestamp() })
    await assertFails(bad.commit())
    const b = writeBatch(db)
    b.update(doc(db, 'orders/o1'), { status: 'por_cobrar', updatedAt: serverTimestamp() })
    b.update(doc(db, 'tables/mesa-1'), { status: 'por_cobrar' })
    await assertSucceeds(b.commit())
  })

  it('mueve la cuenta a una mesa libre y libera la anterior', async () => {
    await seedOpenOrder()
    const db = admin()
    const b = writeBatch(db)
    b.update(doc(db, 'orders/o1'), {
      tableId: 'mesa-2',
      tableName: 'Mesa 2',
      updatedAt: serverTimestamp(),
    })
    b.update(doc(db, 'tables/mesa-2'), { status: 'ocupada', currentOrderId: 'o1' })
    b.update(doc(db, 'tables/mesa-1'), { status: 'disponible', currentOrderId: null })
    await assertSucceeds(b.commit())
  })

  it('no mueve a una mesa fuera de servicio', async () => {
    await seedOpenOrder()
    await seed(async (db) => {
      await updateDoc(doc(db, 'tables/mesa-2'), { status: 'fuera_servicio' })
    })
    const db = admin()
    const b = writeBatch(db)
    b.update(doc(db, 'orders/o1'), {
      tableId: 'mesa-2',
      tableName: 'Mesa 2',
      updatedAt: serverTimestamp(),
    })
    b.update(doc(db, 'tables/mesa-2'), { status: 'ocupada', currentOrderId: 'o1' })
    b.update(doc(db, 'tables/mesa-1'), { status: 'disponible', currentOrderId: null })
    await assertFails(b.commit())
  })

  it('no libera la mesa mientras la cuenta siga abierta', async () => {
    await seedOpenOrder()
    await assertFails(
      updateDoc(doc(admin(), 'tables/mesa-1'), { status: 'disponible', currentOrderId: null }),
    )
  })

  it('cierra sin consumo solo con subtotal 0', async () => {
    await seedOpenOrder()
    const db = admin()
    const close = () => {
      const b = writeBatch(db)
      b.update(doc(db, 'orders/o1'), {
        status: 'cerrada_sin_consumo',
        closedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      b.update(doc(db, 'tables/mesa-1'), { status: 'disponible', currentOrderId: null })
      return b.commit()
    }
    await assertFails(close())
    await seed(async (sdb) => {
      await setDoc(
        doc(sdb, 'orders/o1'),
        order({ items: { l1: line({ cancelledQty: 3, lastCancelId: 'x' }) }, lastLineId: 'l1' }),
      )
    })
    await assertSucceeds(close())
  })

  it('una cuenta cerrada no se modifica', async () => {
    await seedOpenOrder({ status: 'cerrada_sin_consumo', subtotal: 0, closedAt: T0 })
    await assertFails(
      updateDoc(doc(admin(), 'orders/o1'), { status: 'abierta', updatedAt: serverTimestamp() }),
    )
  })

  it('las cuentas no se borran', async () => {
    await seedOpenOrder()
    const { deleteDoc } = await import('firebase/firestore')
    await assertFails(deleteDoc(doc(admin(), 'orders/o1')))
  })
})

describe('mesas', () => {
  it('crea y renombra mesas; el número no cambia', async () => {
    await seedBase()
    const db = admin()
    await assertSucceeds(setDoc(doc(db, 'tables/mesa-6'), table(6, { name: 'Terraza' })))
    await assertFails(setDoc(doc(db, 'tables/mesa-7'), table(8)))
    await assertSucceeds(updateDoc(doc(db, 'tables/mesa-6'), { name: 'Terraza 1' }))
    await assertFails(updateDoc(doc(db, 'tables/mesa-6'), { number: 9 }))
  })

  it('una mesa con cuenta no se pone fuera de servicio ni se desactiva', async () => {
    await seedOpenOrder()
    const db = admin()
    await assertFails(updateDoc(doc(db, 'tables/mesa-1'), { active: false }))
    await assertSucceeds(updateDoc(doc(db, 'tables/mesa-2'), { status: 'fuera_servicio' }))
  })
})
