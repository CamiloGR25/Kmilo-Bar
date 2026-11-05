/** Reglas de la Fase 2: categorías, productos, historial de precios y auditoría. */
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
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

const admin = () => env.authenticatedContext(ADMIN_UID).firestore()
const stranger = () => env.authenticatedContext('otro').firestore()

const product = (over: Record<string, unknown> = {}) => ({
  name: 'Cerveza nacional 330 ml',
  description: '',
  categoryId: 'cervezas',
  unit: 'botella',
  stock: 0,
  minStock: 24,
  avgCost: 2400,
  lastPurchaseCost: 2400,
  salePrice: 3600,
  pricingMode: 'auto',
  markupBp: null,
  active: true,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...over,
})

/** Siembra un producto saltándose las reglas (para probar actualizaciones). */
async function seedProduct(id: string, over: Record<string, unknown> = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'products', id), product(over))
  })
}

const audit = (over: Record<string, unknown> = {}) => ({
  action: 'crear',
  entity: 'product',
  entityId: 'p1',
  summary: 'Producto creado',
  before: null,
  after: null,
  reason: null,
  uid: ADMIN_UID,
  at: serverTimestamp(),
  ...over,
})

describe('categorías', () => {
  it('el administrador crea y edita; nadie más', async () => {
    const data = { name: 'Cervezas', icon: 'beer', active: true, sortOrder: 1 }
    await assertSucceeds(setDoc(doc(admin(), 'categories/cervezas'), data))
    await assertSucceeds(updateDoc(doc(admin(), 'categories/cervezas'), { active: false }))
    await assertFails(setDoc(doc(stranger(), 'categories/x'), data))
    await assertFails(getDoc(doc(stranger(), 'categories/cervezas')))
  })
  it('valida campos y no permite borrar', async () => {
    await assertFails(
      setDoc(doc(admin(), 'categories/x'), { name: '', icon: 'beer', active: true, sortOrder: 1 }),
    )
    await assertFails(
      setDoc(doc(admin(), 'categories/x'), {
        name: 'X',
        icon: 'beer',
        active: true,
        sortOrder: 1,
        extra: 1,
      }),
    )
    await assertSucceeds(
      setDoc(doc(admin(), 'categories/x'), { name: 'X', icon: 'beer', active: true, sortOrder: 1 }),
    )
    await assertFails(deleteDoc(doc(admin(), 'categories/x')))
  })
})

describe('productos', () => {
  it('se crean con stock 0 y campos válidos', async () => {
    await assertSucceeds(setDoc(doc(admin(), 'products/p1'), product()))
    await assertFails(setDoc(doc(admin(), 'products/p2'), product({ stock: 10 })))
    await assertFails(setDoc(doc(admin(), 'products/p3'), product({ salePrice: -100 })))
    await assertFails(setDoc(doc(admin(), 'products/p4'), product({ salePrice: 3600.5 })))
    await assertFails(setDoc(doc(admin(), 'products/p5'), product({ unit: 'litro' })))
    await assertFails(setDoc(doc(stranger(), 'products/p6'), product()))
  })

  it('el catálogo no puede cambiar el stock', async () => {
    await seedProduct('p1', { stock: 5 })
    await assertFails(
      updateDoc(doc(admin(), 'products/p1'), { stock: 50, updatedAt: serverTimestamp() }),
    )
    await assertSucceeds(
      updateDoc(doc(admin(), 'products/p1'), { salePrice: 4000, updatedAt: serverTimestamp() }),
    )
  })

  it('el costo solo se edita a mano si no hay stock (D-105)', async () => {
    await seedProduct('sin-stock', { stock: 0 })
    await seedProduct('con-stock', { stock: 8 })
    await assertSucceeds(
      updateDoc(doc(admin(), 'products/sin-stock'), {
        avgCost: 2600,
        updatedAt: serverTimestamp(),
      }),
    )
    await assertFails(
      updateDoc(doc(admin(), 'products/con-stock'), {
        avgCost: 2600,
        updatedAt: serverTimestamp(),
      }),
    )
  })

  it('no se borran (se desactivan)', async () => {
    await seedProduct('p1')
    await assertFails(deleteDoc(doc(admin(), 'products/p1')))
    await assertSucceeds(
      updateDoc(doc(admin(), 'products/p1'), { active: false, updatedAt: serverTimestamp() }),
    )
  })
})

describe('historial de precios', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    productId: 'p1',
    field: 'salePrice',
    oldValue: 3600,
    newValue: 4000,
    source: 'manual',
    reason: null,
    at: serverTimestamp(),
    ...over,
  })

  it('se crea en el mismo batch que el producto', async () => {
    const db = admin()
    const batch = writeBatch(db)
    batch.set(doc(db, 'products/p1'), product())
    batch.set(doc(collection(db, 'priceHistory')), entry({ oldValue: null }))
    await assertSucceeds(batch.commit())
  })

  it('no se crea para productos inexistentes y es inmutable', async () => {
    await assertFails(setDoc(doc(admin(), 'priceHistory/h0'), entry({ productId: 'fantasma' })))
    await seedProduct('p1')
    await assertSucceeds(setDoc(doc(admin(), 'priceHistory/h1'), entry()))
    await assertFails(updateDoc(doc(admin(), 'priceHistory/h1'), { newValue: 1 }))
    await assertFails(deleteDoc(doc(admin(), 'priceHistory/h1')))
  })
})

describe('auditoría', () => {
  it('es inmutable y exige el UID y la hora del servidor', async () => {
    const db = admin()
    await assertSucceeds(setDoc(doc(db, 'auditLog/a1'), audit()))
    await assertFails(updateDoc(doc(db, 'auditLog/a1'), { summary: 'cambiado' }))
    await assertFails(deleteDoc(doc(db, 'auditLog/a1')))
    await assertFails(setDoc(doc(db, 'auditLog/a2'), audit({ uid: 'otro' })))
    await assertFails(setDoc(doc(db, 'auditLog/a3'), audit({ at: new Date(0) })))
  })
})
