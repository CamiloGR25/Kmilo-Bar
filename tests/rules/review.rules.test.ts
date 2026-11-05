/** Reglas de la Fase 6: revisión de inventario (R-INV-11) y campos nuevos de dailyStats (D-221). */
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

const REVIEW = 'counters/inventoryReview'

const reviewDoc = (over = {}) => ({
  periodMonths: 4,
  lastReviewDate: '2026-11-05',
  scheduledDate: null,
  inProgressId: null,
  startedAt: null,
  updatedAt: serverTimestamp(),
  ...over,
})

async function seedCounters(cashOpen: boolean, review?: Record<string, unknown>) {
  await seed(async (db) => {
    await setDoc(doc(db, 'counters/cashSessions'), {
      last: cashOpen ? 1 : 0,
      openSessionId: cashOpen ? 'cs1' : null,
    })
    if (review) await setDoc(doc(db, REVIEW), review)
  })
}

const seededReview = (over = {}) => ({ ...reviewDoc(), updatedAt: new Date(), ...over })

describe('revisión de inventario (R-INV-11)', () => {
  it('se crea con valores válidos y sin revisión en curso', async () => {
    await seedCounters(false)
    await assertSucceeds(setDoc(doc(admin(), REVIEW), reviewDoc()))
  })

  it('valida periodo, fechas y campos', async () => {
    await seedCounters(false)
    const db = admin()
    await assertFails(setDoc(doc(db, REVIEW), reviewDoc({ periodMonths: 0 })))
    await assertFails(setDoc(doc(db, REVIEW), reviewDoc({ periodMonths: 13 })))
    await assertFails(setDoc(doc(db, REVIEW), reviewDoc({ lastReviewDate: 'ayer' })))
    await assertFails(setDoc(doc(db, REVIEW), reviewDoc({ otro: 1 })))
    await assertFails(
      setDoc(doc(db, REVIEW), reviewDoc({ inProgressId: 'r1', startedAt: serverTimestamp() })),
    )
  })

  it('programa el día', async () => {
    await seedCounters(false, seededReview())
    await assertSucceeds(
      updateDoc(doc(admin(), REVIEW), {
        scheduledDate: '2027-02-20',
        updatedAt: serverTimestamp(),
      }),
    )
  })

  it('empieza solo con la caja cerrada', async () => {
    await seedCounters(true, seededReview())
    await assertFails(
      updateDoc(doc(admin(), REVIEW), {
        inProgressId: 'r1',
        startedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    )
  })

  it('empieza con la caja cerrada y termina con la fecha de hoy', async () => {
    await seedCounters(false, seededReview())
    const db = admin()
    await assertSucceeds(
      updateDoc(doc(db, REVIEW), {
        inProgressId: 'r1',
        startedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    )
    await assertSucceeds(
      updateDoc(doc(db, REVIEW), {
        inProgressId: null,
        startedAt: null,
        scheduledDate: null,
        lastReviewDate: '2026-11-06',
        updatedAt: serverTimestamp(),
      }),
    )
  })

  it('una revisión en curso no se reemplaza por otra', async () => {
    await seedCounters(false, seededReview({ inProgressId: 'r1', startedAt: new Date() }))
    await assertFails(
      updateDoc(doc(admin(), REVIEW), {
        inProgressId: 'r2',
        startedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    )
  })

  it('no se abre caja mientras hay una revisión en curso', async () => {
    const open = (db: Firestore) => {
      const b = writeBatch(db)
      b.update(doc(db, 'counters/cashSessions'), { last: 1, openSessionId: 'cs1' })
      b.set(doc(db, 'cashSessions/cs1'), {
        number: 1,
        businessDate: '2026-11-06',
        status: 'abierta',
        openingBalance: 100000,
        openedAt: serverTimestamp(),
        openedBy: ADMIN_UID,
        closedAt: null,
      })
      return b.commit()
    }
    await seedCounters(false, seededReview({ inProgressId: 'r1', startedAt: new Date() }))
    await assertFails(open(admin()))
    await seed((db) => updateDoc(doc(db, REVIEW), { inProgressId: null, startedAt: null }))
    await assertSucceeds(open(admin()))
  })

  it('nadie más que el administrador la lee o la cambia', async () => {
    await seedCounters(false, seededReview())
    const other = env.authenticatedContext('otro').firestore() as unknown as Firestore
    await assertFails(updateDoc(doc(other, REVIEW), { scheduledDate: '2027-01-01' }))
  })
})

describe('dailyStats con pérdidas y horas (D-221)', () => {
  const DAY = '2026-11-06'
  it('acepta pérdidas, sobrantes, tipos y horas', async () => {
    await assertSucceeds(
      setDoc(
        doc(admin(), `dailyStats/${DAY}`),
        {
          businessDate: DAY,
          invLosses: increment(4800),
          invGains: increment(2400),
          byLossType: { merma: increment(4800) },
          byHour: { '22': increment(9000) },
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
    )
  })

  it('no acepta pérdidas negativas ni campos desconocidos', async () => {
    const ref = doc(admin(), `dailyStats/${DAY}`)
    await assertFails(
      setDoc(ref, { businessDate: DAY, invLosses: -1, updatedAt: serverTimestamp() }),
    )
    await assertFails(setDoc(ref, { businessDate: DAY, otro: 1, updatedAt: serverTimestamp() }))
  })
})
