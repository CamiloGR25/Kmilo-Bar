import { describe, expect, it } from 'vitest'
import {
  correctionStats,
  lossStats,
  paidOrderStats,
  paymentStats,
} from '@/domain/metrics/daily-stats'

const line = (over = {}) => ({
  productId: 'aguila',
  nameSnap: 'Águila',
  categoryIdSnap: 'cervezas',
  unitPrice: 4_500,
  unitCostSnap: 2_400,
  qty: 3,
  cancelledQty: 0,
  lostQty: 0,
  ...over,
})

describe('paidOrderStats (F-04, F-07)', () => {
  it('suma solo las unidades activas, por producto y categoría', () => {
    const d = paidOrderStats([
      line(),
      line({ qty: 2, cancelledQty: 1 }), // otra ronda del mismo producto: 1 activa
      line({
        productId: 'ron',
        nameSnap: 'Ron',
        categoryIdSnap: 'rones',
        unitPrice: 9_000,
        unitCostSnap: 5_000,
        qty: 1,
      }),
      line({ productId: 'x', qty: 2, lostQty: 2 }), // perdida: no es venta
    ])
    expect(d.salesGross).toBe(4 * 4_500 + 9_000)
    expect(d.cogs).toBe(4 * 2_400 + 5_000)
    expect(d.ordersCount).toBe(1)
    expect(d.byProduct).toEqual({
      aguila: { name: 'Águila', categoryId: 'cervezas', qty: 4, sales: 18_000, cogs: 9_600 },
      ron: { name: 'Ron', categoryId: 'rones', qty: 1, sales: 9_000, cogs: 5_000 },
    })
    expect(d.byCategory).toEqual({
      cervezas: { qty: 4, sales: 18_000, cogs: 9_600 },
      rones: { qty: 1, sales: 9_000, cogs: 5_000 },
    })
  })
})

describe('paymentStats (F-06)', () => {
  it('registra medio y canal', () => {
    expect(paymentStats({ method: 'efectivo', channel: null, amount: 5_000 })).toEqual({
      collected: 5_000,
      byMethod: { efectivo: 5_000 },
    })
    expect(paymentStats({ method: 'transferencia', channel: 'nequi', amount: 7_000 })).toEqual({
      collected: 7_000,
      byMethod: { transferencia: 7_000 },
      byChannel: { nequi: 7_000 },
    })
  })
})

describe('correctionStats (D-219)', () => {
  it('mueve el monto de un medio a otro sin cambiar lo cobrado', () => {
    expect(
      correctionStats(
        { method: 'efectivo', channel: null },
        { method: 'transferencia', channel: 'banco' },
        3_000,
      ),
    ).toEqual({ byMethod: { efectivo: -3_000, transferencia: 3_000 }, byChannel: { banco: 3_000 } })
    expect(
      correctionStats(
        { method: 'transferencia', channel: 'nequi' },
        { method: 'transferencia', channel: 'daviplata' },
        3_000,
      ),
    ).toEqual({ byMethod: { transferencia: 0 }, byChannel: { nequi: -3_000, daviplata: 3_000 } })
  })
})

describe('lossStats (F-10)', () => {
  it('valora a costo', () => {
    expect(lossStats(2, 2_400)).toEqual({ orderLosses: 4_800 })
  })
})
