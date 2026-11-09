/** Reglas de la Fase 8: categorías, gastos fijos, gastos y capital (R-FIN-02…04, D-226). */
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  deleteDoc,
  doc,
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

async function seedCash(open: boolean) {
  await seed(async (db) => {
    await setDoc(doc(db, 'counters/cashSessions'), { last: 1, openSessionId: open ? 'cs1' : null })
    await setDoc(doc(db, 'cashSessions/cs1'), {
      number: 1,
      businessDate: DAY,
      status: open ? 'abierta' : 'cerrada',
      openingBalance: 200000,
      openedAt: T0,
      openedBy: ADMIN_UID,
      closedAt: null,
    })
  })
}

const expense = (over: Record<string, unknown> = {}) => ({
  categoryId: 'arriendo',
  categoryName: 'Arriendo',
  kind: 'fijo',
  amount: 1000000,
  businessDate: DAY,
  description: '',
  method: 'transferencia',
  fromCash: false,
  cashSessionId: null,
  fixedExpenseId: null,
  period: null,
  status: 'activo',
  voidReason: null,
  voidedAt: null,
  uid: ADMIN_UID,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...over,
})

const capital = (over: Record<string, unknown> = {}) => ({
  type: 'inversion_inicial',
  amount: 2000000,
  businessDate: '2026-09-01',
  description: 'Nevera',
  fromCash: false,
  cashSessionId: null,
  status: 'activo',
  voidReason: null,
  voidedAt: null,
  uid: ADMIN_UID,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...over,
})

const cashMove = (id: string, over: Record<string, unknown>) => ({
  sessionId: 'cs1',
  businessDate: DAY,
  reason: 'Pago',
  uid: ADMIN_UID,
  createdAt: serverTimestamp(),
  ...over,
})

describe('categorías y gastos fijos (D-226 #2, #3)', () => {
  it('crea categorías y gastos fijos válidos', async () => {
    const db = admin()
    await assertSucceeds(
      setDoc(doc(db, 'expenseCategories/arriendo'), {
        name: 'Arriendo',
        kind: 'fijo',
        active: true,
        sortOrder: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    )
    await assertFails(
      setDoc(doc(db, 'expenseCategories/x'), {
        name: 'X',
        kind: 'otro',
        active: true,
        sortOrder: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    )
    await assertSucceeds(
      setDoc(doc(db, 'fixedExpenses/f1'), {
        name: 'Arriendo local',
        categoryId: 'arriendo',
        amount: 1000000,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    )
  })
})

describe('gastos (F8-01, R-FIN-03/04)', () => {
  it('por fuera, sin tocar la caja', async () => {
    await seedCash(false)
    await assertSucceeds(setDoc(doc(admin(), 'expenses/e1'), expense()))
  })

  it('de la caja, con su salida en el mismo commit', async () => {
    await seedCash(true)
    const db = admin()
    const b = writeBatch(db)
    b.set(
      doc(db, 'expenses/e1'),
      expense({ method: 'efectivo', fromCash: true, cashSessionId: 'cs1', amount: 50000 }),
    )
    b.set(
      doc(db, 'cashMovements/ex-e1'),
      cashMove('ex-e1', { type: 'gasto', amount: -50000, refType: 'expense', refId: 'e1' }),
    )
    await assertSucceeds(b.commit())
  })

  it('de la caja sin la salida, o sin caja abierta, no pasa', async () => {
    await seedCash(true)
    await assertFails(
      setDoc(
        doc(admin(), 'expenses/e1'),
        expense({ method: 'efectivo', fromCash: true, cashSessionId: 'cs1' }),
      ),
    )
    await seedCash(false)
    const db = admin()
    const b = writeBatch(db)
    b.set(
      doc(db, 'expenses/e2'),
      expense({ method: 'efectivo', fromCash: true, cashSessionId: 'cs1', amount: 5 }),
    )
    b.set(
      doc(db, 'cashMovements/ex-e2'),
      cashMove('ex-e2', { type: 'gasto', amount: -5, refType: 'expense', refId: 'e2' }),
    )
    await assertFails(b.commit())
  })

  it('una salida "gasto" sin su gasto no pasa', async () => {
    await seedCash(true)
    await assertFails(
      setDoc(
        doc(admin(), 'cashMovements/m1'),
        cashMove('m1', { type: 'gasto', amount: -1000, refType: 'expense', refId: 'nada' }),
      ),
    )
  })

  it('solo se anula con motivo; no se edita ni se borra', async () => {
    await seedCash(false)
    const db = admin()
    await setDoc(doc(db, 'expenses/e1'), expense())
    await assertFails(
      updateDoc(doc(db, 'expenses/e1'), { amount: 1, updatedAt: serverTimestamp() }),
    )
    await assertFails(deleteDoc(doc(db, 'expenses/e1')))
    await assertSucceeds(
      updateDoc(doc(db, 'expenses/e1'), {
        status: 'anulado',
        voidReason: 'Registrado dos veces',
        voidedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    )
  })
})

describe('capital (F8-04, R-FIN-02)', () => {
  it('inversión inicial por ítem, por fuera', async () => {
    await seedCash(false)
    await assertSucceeds(setDoc(doc(admin(), 'capitalEntries/c1'), capital()))
  })

  it('la inversión inicial no pasa por la caja', async () => {
    await seedCash(true)
    await assertFails(
      setDoc(doc(admin(), 'capitalEntries/c1'), capital({ fromCash: true, cashSessionId: 'cs1' })),
    )
  })

  it('aporte que entra a la caja y retiro que sale de ella', async () => {
    await seedCash(true)
    const db = admin()
    const a = writeBatch(db)
    a.set(
      doc(db, 'capitalEntries/c1'),
      capital({
        type: 'aporte',
        amount: 100000,
        businessDate: DAY,
        fromCash: true,
        cashSessionId: 'cs1',
      }),
    )
    a.set(
      doc(db, 'cashMovements/cap-c1'),
      cashMove('cap-c1', { type: 'aporte', amount: 100000, refType: 'capital', refId: 'c1' }),
    )
    await assertSucceeds(a.commit())
    const r = writeBatch(db)
    r.set(
      doc(db, 'capitalEntries/c2'),
      capital({
        type: 'retiro',
        amount: 50000,
        businessDate: DAY,
        fromCash: true,
        cashSessionId: 'cs1',
      }),
    )
    r.set(
      doc(db, 'cashMovements/cap-c2'),
      cashMove('cap-c2', { type: 'retiro_dueno', amount: -50000, refType: 'capital', refId: 'c2' }),
    )
    await assertSucceeds(r.commit())
  })

  it('un retiro "de capital" que no cuadra con su registro no pasa', async () => {
    await seedCash(true)
    const db = admin()
    const r = writeBatch(db)
    r.set(
      doc(db, 'capitalEntries/c2'),
      capital({
        type: 'retiro',
        amount: 50000,
        businessDate: DAY,
        fromCash: true,
        cashSessionId: 'cs1',
      }),
    )
    r.set(
      doc(db, 'cashMovements/cap-c2'),
      cashMove('cap-c2', { type: 'retiro_dueno', amount: -99999, refType: 'capital', refId: 'c2' }),
    )
    await assertFails(r.commit())
  })

  it('lo que pasó por la caja no se anula desde capital', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'capitalEntries/c1'), {
        ...capital({ type: 'aporte', fromCash: true, cashSessionId: 'cs1' }),
        createdAt: T0,
        updatedAt: T0,
      })
    })
    await assertFails(
      updateDoc(doc(admin(), 'capitalEntries/c1'), {
        status: 'anulado',
        voidReason: 'Error',
        voidedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    )
  })
})
