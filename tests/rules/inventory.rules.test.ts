/** Reglas de la Fase 3: el stock solo cambia junto a un movimiento que cuadra (R-INV-01/02). */
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
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

async function seedProduct(id: string, stock: number, avgCost = 2400) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'products', id), {
      name: `Producto ${id}`,
      description: '',
      categoryId: 'cervezas',
      unit: 'botella',
      stock,
      minStock: 6,
      avgCost,
      lastPurchaseCost: avgCost,
      salePrice: 3600,
      pricingMode: 'auto',
      markupBp: null,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  })
}

interface Move {
  productId: string
  movId: string
  type: string
  qty: number
  stockBefore: number
  avgCostBefore?: number
  avgCostAfter?: number
  reason?: string | null
}

/** Agrega al batch la pareja producto + movimiento, como lo hace el servicio. */
function addMove(
  db: ReturnType<typeof admin>,
  batch: ReturnType<typeof writeBatch>,
  m: Move,
  over = {},
) {
  const avgBefore = m.avgCostBefore ?? 2400
  const avgAfter = m.avgCostAfter ?? avgBefore
  const stockAfter = m.stockBefore + m.qty
  batch.update(doc(db, 'products', m.productId), {
    stock: stockAfter,
    avgCost: avgAfter,
    lastMovementId: m.movId,
    updatedAt: serverTimestamp(),
  })
  batch.set(doc(db, 'inventoryMovements', m.movId), {
    productId: m.productId,
    productName: 'x',
    type: m.type,
    qty: m.qty,
    stockBefore: m.stockBefore,
    stockAfter,
    avgCostBefore: avgBefore,
    avgCostAfter: avgAfter,
    unitCost: avgAfter,
    sourceType: 'ajuste',
    sourceId: m.movId,
    reason: m.reason ?? null,
    businessDate: '2026-11-04',
    uid: ADMIN_UID,
    createdAt: serverTimestamp(),
    ...over,
  })
}

describe('movimientos de inventario', () => {
  it('una entrada válida actualiza stock y costo junto al movimiento', async () => {
    await seedProduct('p1', 10)
    const db = admin()
    const b = writeBatch(db)
    addMove(db, b, {
      productId: 'p1',
      movId: 'adj_1',
      type: 'entrada_manual',
      qty: 20,
      stockBefore: 10,
      avgCostAfter: 2600,
    })
    await assertSucceeds(b.commit())
  })

  it('el stock no cambia sin movimiento', async () => {
    await seedProduct('p1', 10)
    await assertFails(
      updateDoc(doc(admin(), 'products/p1'), {
        stock: 50,
        lastMovementId: 'inventado',
        updatedAt: serverTimestamp(),
      }),
    )
  })

  it('rechaza movimientos que no cuadran con el producto', async () => {
    await seedProduct('p1', 10)
    const db = admin()
    // stockBefore falso (dice 12 y hay 10)
    const b1 = writeBatch(db)
    addMove(db, b1, {
      productId: 'p1',
      movId: 'adj_2',
      type: 'entrada_manual',
      qty: 5,
      stockBefore: 12,
    })
    await assertFails(b1.commit())
    // movimiento sin actualizar el producto
    await assertFails(
      setDoc(doc(db, 'inventoryMovements/adj_3'), {
        productId: 'p1',
        productName: 'x',
        type: 'entrada_manual',
        qty: 5,
        stockBefore: 10,
        stockAfter: 15,
        avgCostBefore: 2400,
        avgCostAfter: 2400,
        unitCost: 2400,
        sourceType: 'ajuste',
        sourceId: 'adj_3',
        reason: null,
        businessDate: '2026-11-04',
        uid: ADMIN_UID,
        createdAt: serverTimestamp(),
      }),
    )
  })

  it('nunca deja stock negativo (R-INV-02)', async () => {
    await seedProduct('p1', 2)
    const db = admin()
    const b = writeBatch(db)
    addMove(db, b, {
      productId: 'p1',
      movId: 'adj_4',
      type: 'merma',
      qty: -3,
      stockBefore: 2,
      reason: 'Rotas',
    })
    await assertFails(b.commit())
  })

  it('las salidas exigen motivo y el signo debe coincidir con el tipo', async () => {
    await seedProduct('p1', 10)
    const db = admin()
    const sinMotivo = writeBatch(db)
    addMove(db, sinMotivo, {
      productId: 'p1',
      movId: 'adj_5',
      type: 'merma',
      qty: -1,
      stockBefore: 10,
    })
    await assertFails(sinMotivo.commit())
    const signoMal = writeBatch(db)
    addMove(db, signoMal, {
      productId: 'p1',
      movId: 'adj_6',
      type: 'merma',
      qty: 1,
      stockBefore: 10,
      reason: 'Rota',
    })
    await assertFails(signoMal.commit())
    const ok = writeBatch(db)
    addMove(db, ok, {
      productId: 'p1',
      movId: 'adj_7',
      type: 'merma',
      qty: -1,
      stockBefore: 10,
      reason: 'Rota',
    })
    await assertSucceeds(ok.commit())
  })

  it('los movimientos son inmutables', async () => {
    await seedProduct('p1', 10)
    const db = admin()
    const b = writeBatch(db)
    addMove(db, b, {
      productId: 'p1',
      movId: 'adj_8',
      type: 'entrada_manual',
      qty: 1,
      stockBefore: 10,
    })
    await assertSucceeds(b.commit())
    await assertFails(updateDoc(doc(db, 'inventoryMovements/adj_8'), { qty: 100 }))
    await assertFails(deleteDoc(doc(db, 'inventoryMovements/adj_8')))
  })

  it('un conteo de 4 productos cabe en una sola transacción', async () => {
    for (const id of ['a', 'b', 'c', 'd']) await seedProduct(id, 10)
    const db = admin()
    const b = writeBatch(db)
    for (const [i, id] of ['a', 'b', 'c', 'd'].entries()) {
      addMove(
        db,
        b,
        {
          productId: id,
          movId: `count_x_${id}`,
          type: 'conteo',
          qty: i + 1,
          stockBefore: 10,
          reason: 'Conteo semanal',
        },
        { sourceType: 'conteo', sourceId: 'x' },
      )
    }
    await assertSucceeds(b.commit())
  })

  it('la edición del catálogo sigue funcionando y no puede tocar el último movimiento', async () => {
    await seedProduct('p1', 10)
    await assertSucceeds(
      updateDoc(doc(admin(), 'products/p1'), { salePrice: 4000, updatedAt: serverTimestamp() }),
    )
    await assertFails(
      updateDoc(doc(admin(), 'products/p1'), { lastMovementId: 'x', updatedAt: serverTimestamp() }),
    )
  })
})
