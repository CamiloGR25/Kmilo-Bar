import { describe, expect, it } from 'vitest'
import {
  applyMovement,
  InventoryError,
  movementSign,
  movementValue,
  requiresReason,
  weightedAverageCost,
} from '../domain/movements'
import {
  inventoryValue,
  isAlert,
  recommendedOrderQty,
  stockLevel,
  suggestedMinStock,
} from '../domain/stock'

describe('R-INV-06 semáforo', () => {
  const near = 15000 // 150 %
  it('clasifica según el mínimo', () => {
    expect(stockLevel(0, 10, near)).toBe('agotado')
    expect(stockLevel(10, 10, near)).toBe('minimo')
    expect(stockLevel(1, 10, near)).toBe('minimo')
    expect(stockLevel(15, 10, near)).toBe('cerca')
    expect(stockLevel(16, 10, near)).toBe('ok')
  })
  it('sin mínimo solo distingue agotado y OK', () => {
    expect(stockLevel(0, 0, near)).toBe('agotado')
    expect(stockLevel(1, 0, near)).toBe('ok')
  })
  it('solo agotado y en mínimo generan alerta', () => {
    expect(['agotado', 'minimo', 'cerca', 'ok'].map((l) => isAlert(l as never))).toEqual([
      true,
      true,
      false,
      false,
    ])
  })
})

describe('R-INV-08 cantidad recomendada', () => {
  it('lleva al stock objetivo (mínimo × 2)', () => {
    expect(recommendedOrderQty(4, 10, 20000)).toBe(16)
    expect(recommendedOrderQty(0, 6, 20000)).toBe(12)
  })
  it('descuenta lo ya pedido y no pide de más', () => {
    expect(recommendedOrderQty(4, 10, 20000, 10)).toBe(6)
    expect(recommendedOrderQty(25, 10, 20000)).toBe(0)
  })
  it('redondea a la unidad de compra (canasta de 30)', () => {
    expect(recommendedOrderQty(10, 24, 20000, 0, 30)).toBe(60) // faltan 38 → 2 canastas
  })
  it('sin mínimo no recomienda', () => {
    expect(recommendedOrderQty(0, 0, 20000)).toBe(0)
  })
})

describe('R-INV-07 mínimo sugerido', () => {
  it('requiere 14 jornadas con ventas', () => {
    expect(suggestedMinStock(100, 28, 13, 2, 2)).toBeNull()
  })
  it('venta diaria × (entrega + seguridad), hacia arriba', () => {
    expect(suggestedMinStock(84, 28, 20, 2, 2)).toBe(12) // 3/día × 4
    expect(suggestedMinStock(50, 28, 14, 2, 2)).toBe(8) // 1,79 × 4 = 7,14
  })
})

describe('F-09 costo promedio ponderado', () => {
  it('pondera por cantidades', () => {
    expect(weightedAverageCost(10, 2400, 20, 2700)).toBe(2600) // (24000+54000)/30
  })
  it('con stock 0 toma el costo de la entrada', () => {
    expect(weightedAverageCost(0, 2400, 12, 2500)).toBe(2500)
  })
  it('redondea al peso', () => {
    expect(weightedAverageCost(1, 1000, 2, 1001)).toBe(1001) // 1000,67
  })
})

describe('applyMovement', () => {
  const state = { stock: 10, avgCost: 2400 }

  it('una entrada suma stock y recalcula el costo', () => {
    expect(applyMovement(state, { type: 'entrada_manual', quantity: 20, unitCost: 2700 })).toEqual({
      qty: 20,
      stockBefore: 10,
      stockAfter: 30,
      avgCostBefore: 2400,
      avgCostAfter: 2600,
      unitCost: 2700,
    })
  })

  it('una merma resta al costo promedio y exige motivo (R-INV-05)', () => {
    expect(() => applyMovement(state, { type: 'merma', quantity: 2 })).toThrow(/motivo/)
    const r = applyMovement(state, { type: 'merma', quantity: 2, reason: 'Botella rota' })
    expect(r).toMatchObject({ qty: -2, stockAfter: 8, avgCostAfter: 2400, unitCost: 2400 })
    expect(movementValue(r)).toBe(-4800)
  })

  it('nunca deja stock negativo (R-INV-02)', () => {
    expect(() =>
      applyMovement(state, { type: 'consumo_propio', quantity: 11, reason: 'Prueba' }),
    ).toThrow(InventoryError)
    expect(() =>
      applyMovement(state, { type: 'consumo_propio', quantity: 11, reason: 'Prueba' }),
    ).toThrow(/hay 10/)
  })

  it('el conteo aplica la diferencia con signo', () => {
    expect(
      applyMovement(state, { type: 'conteo', quantity: -3, reason: 'Conteo semanal' }),
    ).toMatchObject({
      qty: -3,
      stockAfter: 7,
    })
    expect(
      applyMovement(state, { type: 'conteo', quantity: 2, reason: 'Conteo semanal' }).stockAfter,
    ).toBe(12)
  })

  it('valida cantidad y costo', () => {
    expect(() =>
      applyMovement(state, { type: 'entrada_manual', quantity: 0, unitCost: 1 }),
    ).toThrow(/distinto de cero/)
    expect(() =>
      applyMovement(state, { type: 'entrada_manual', quantity: 1.5, unitCost: 1 }),
    ).toThrow(/entero/)
    expect(() =>
      applyMovement(state, { type: 'entrada_manual', quantity: -1, unitCost: 1 }),
    ).toThrow(/positiva/)
    expect(() => applyMovement(state, { type: 'entrada_manual', quantity: 2 })).toThrow(/costo/)
  })

  it('signos y motivos por tipo', () => {
    expect(movementSign('venta')).toBe(-1)
    expect(movementSign('anulacion_venta')).toBe(1)
    expect(requiresReason('entrada_manual')).toBe(false)
    expect(requiresReason('cortesia')).toBe(true)
  })

  it('invariante: el stock es la suma de los movimientos', () => {
    let s = { stock: 0, avgCost: 0 }
    const moves = [
      { type: 'entrada_inicial', quantity: 24, unitCost: 2400 },
      { type: 'merma', quantity: 1, reason: 'Rota' },
      { type: 'entrada_manual', quantity: 12, unitCost: 2700 },
      { type: 'cortesia', quantity: 2, reason: 'Cliente frecuente' },
      { type: 'conteo', quantity: -1, reason: 'Conteo' },
    ] as const
    let sum = 0
    for (const m of moves) {
      const r = applyMovement(s, m)
      sum += r.qty
      s = { stock: r.stockAfter, avgCost: r.avgCostAfter }
    }
    expect(s.stock).toBe(sum)
    expect(s.stock).toBe(32)
    expect(s.avgCost).toBe(2503) // (23 × 2400 + 12 × 2700) / 35 = 2502,86; las salidas no lo cambian
  })
})

describe('F-14 valor del inventario', () => {
  it('suma stock × costo promedio', () => {
    expect(
      inventoryValue([
        { stock: 10, avgCost: 2400 },
        { stock: 2, avgCost: 48000 },
      ]),
    ).toBe(120000)
  })
})
