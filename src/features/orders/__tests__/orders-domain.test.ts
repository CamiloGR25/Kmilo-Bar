import { describe, expect, it } from 'vitest'
import { validateOpeningBalance } from '@/features/cash/domain/cash'
import { nextTableNumber, newTable, validateTableName } from '@/features/tables/domain/tables'
import {
  activeQty,
  buildLine,
  canCloseWithoutConsumption,
  changeRoundQty,
  formatElapsed,
  groupLines,
  normalizeLabel,
  orderLossValue,
  orderSubtotal,
  orderTitle,
  planCancellation,
  roundTotal,
  splitGroupCancellation,
  tableStatusFor,
  type OrderLine,
  type SellableProduct,
} from '../domain/orders'

const product: SellableProduct = {
  id: 'aguila',
  name: 'Águila 330 ml',
  categoryId: 'cervezas',
  stock: 10,
  avgCost: 2400,
  salePrice: 4500,
  active: true,
}

function line(over: Partial<OrderLine> = {}): OrderLine {
  return {
    lineId: 'l1',
    productId: 'aguila',
    nameSnap: 'Águila 330 ml',
    categoryIdSnap: 'cervezas',
    unitPrice: 4500,
    unitCostSnap: 2400,
    qty: 3,
    cancelledQty: 0,
    lostQty: 0,
    lastCancelId: null,
    addedAt: null,
    ...over,
  }
}

describe('venta de una línea (R-VEN-03)', () => {
  it('congela precio y costo del producto', () => {
    const l = buildLine(product, 2)
    expect(l).toMatchObject({ unitPrice: 4500, unitCostSnap: 2400, qty: 2, cancelledQty: 0 })
  })

  it('nunca vende más que el stock (R-INV-02)', () => {
    expect(() => buildLine(product, 11)).toThrow('Solo quedan 10')
    expect(() => buildLine({ ...product, stock: 0 }, 1)).toThrow('agotado')
  })

  it('no vende productos inactivos ni con precio $0 (R-INV-10, D-217)', () => {
    expect(() => buildLine({ ...product, active: false }, 1)).toThrow('desactivado')
    expect(() => buildLine({ ...product, salePrice: 0 }, 1)).toThrow('precio')
  })

  it('rechaza cantidades no enteras o no positivas', () => {
    expect(() => buildLine(product, 0)).toThrow('entero')
    expect(() => buildLine(product, 1.5)).toThrow('entero')
  })
})

describe('ronda (D-217)', () => {
  let n = 0
  const id = () => `line-${++n}`

  it('agrega, suma y quita unidades, sin pasar del stock', () => {
    let r = changeRoundQty([], 'aguila', 1, 2, id)
    expect(r).toEqual([{ lineId: 'line-1', productId: 'aguila', qty: 1 }])
    r = changeRoundQty(r, 'aguila', 1, 2, id)
    r = changeRoundQty(r, 'aguila', 1, 2, id)
    expect(r[0]).toMatchObject({ qty: 2, lineId: 'line-1' }) // tope = stock
    r = changeRoundQty(r, 'aguila', -2, 2, id)
    expect(r).toEqual([])
  })

  it('no agrega productos agotados', () => {
    expect(changeRoundQty([], 'x', 1, 0, id)).toEqual([])
  })

  it('suma el total con los precios actuales', () => {
    const r = [
      { lineId: 'a', productId: 'aguila', qty: 2 },
      { lineId: 'b', productId: 'agua', qty: 1 },
    ]
    expect(roundTotal(r, (p) => (p === 'aguila' ? 4500 : 3000))).toBe(12000)
  })
})

describe('subtotal y cancelaciones (R-VEN-05, D-217)', () => {
  it('el subtotal solo cuenta las unidades activas', () => {
    const lines = [line(), line({ lineId: 'l2', qty: 2, cancelledQty: 1, lostQty: 1 })]
    expect(activeQty(lines[1]!)).toBe(0)
    expect(orderSubtotal(lines)).toBe(13500)
    expect(orderLossValue(lines)).toBe(2400)
  })

  it('cancelación parcial no servida: vuelve al stock', () => {
    const plan = planCancellation(line(), 1, 'devolver', 'No la quiso')
    expect(plan).toEqual({ cancelledQty: 1, lostQty: 0, returnQty: 1, subtotalDelta: -4500 })
  })

  it('servida no cobrada: pérdida sin devolver stock', () => {
    const plan = planCancellation(line({ cancelledQty: 1 }), 2, 'perdida', 'Se fue sin pagar')
    expect(plan).toEqual({ cancelledQty: 1, lostQty: 2, returnQty: 0, subtotalDelta: -9000 })
  })

  it('exige motivo y no cancela más de lo activo', () => {
    expect(() => planCancellation(line(), 1, 'devolver', ' ')).toThrow('motivo')
    expect(() => planCancellation(line({ lostQty: 2 }), 2, 'devolver', 'Error')).toThrow(
      'Solo hay 1',
    )
  })

  it('cerrar sin consumo solo con subtotal 0 y cuenta abierta', () => {
    expect(canCloseWithoutConsumption({ status: 'abierta', subtotal: 0 })).toBe(true)
    expect(canCloseWithoutConsumption({ status: 'por_cobrar', subtotal: 0 })).toBe(true)
    expect(canCloseWithoutConsumption({ status: 'abierta', subtotal: 4500 })).toBe(false)
    expect(canCloseWithoutConsumption({ status: 'cerrada_sin_consumo', subtotal: 0 })).toBe(false)
  })
})

describe('presentación', () => {
  it('estado de la mesa según la cuenta', () => {
    expect(tableStatusFor('abierta')).toBe('ocupada')
    expect(tableStatusFor('por_cobrar')).toBe('por_cobrar')
  })

  it('título de la cuenta', () => {
    expect(orderTitle({ type: 'mesa', tableName: 'Mesa 3', label: null, number: 7 })).toBe('Mesa 3')
    expect(orderTitle({ type: 'barra', tableName: null, label: 'Juan', number: 7 })).toBe(
      'Barra: Juan',
    )
    expect(orderTitle({ type: 'barra', tableName: null, label: null, number: 7 })).toBe('Barra #7')
  })

  it('tiempo abierta', () => {
    const from = new Date('2026-11-05T22:00:00-05:00')
    expect(formatElapsed(from, new Date('2026-11-05T22:00:30-05:00'))).toBe('Recién abierta')
    expect(formatElapsed(from, new Date('2026-11-05T22:25:00-05:00'))).toBe('25 min')
    expect(formatElapsed(from, new Date('2026-11-05T23:20:00-05:00'))).toBe('1 h 20 min')
    expect(formatElapsed(from, new Date('2026-11-06T00:00:00-05:00'))).toBe('2 h')
  })

  it('nombre de la cuenta de barra', () => {
    expect(normalizeLabel('  Juan   y  Ana ')).toBe('Juan y Ana')
    expect(normalizeLabel('   ')).toBeNull()
  })
})

describe('mesas y caja', () => {
  it('mesas nuevas y siguiente número', () => {
    expect(newTable(3)).toMatchObject({ name: 'Mesa 3', status: 'disponible', active: true })
    expect(nextTableNumber([{ number: 1 }, { number: 5 }])).toBe(6)
    expect(nextTableNumber([])).toBe(1)
    expect(validateTableName('  ')).not.toBeNull()
    expect(validateTableName('Terraza')).toBeNull()
  })

  it('saldo inicial de la caja', () => {
    expect(validateOpeningBalance(0)).toBeNull()
    expect(validateOpeningBalance(150000)).toBeNull()
    expect(validateOpeningBalance(null)).not.toBeNull()
    expect(validateOpeningBalance(-1)).not.toBeNull()
    expect(validateOpeningBalance(50_000_000)).not.toBeNull()
  })
})

describe('cuenta agrupada por producto (D-218)', () => {
  const lines = [
    line({ lineId: 'a', qty: 2 }),
    line({ lineId: 'b', productId: 'agua', nameSnap: 'Agua', unitPrice: 2500, qty: 1 }),
    line({ lineId: 'c', qty: 3, cancelledQty: 1 }),
  ]

  it('suma en un renglón las rondas del mismo producto y precio', () => {
    const groups = groupLines(lines)
    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ productId: 'aguila', qty: 5, activeQty: 4, cancelledQty: 1 })
    expect(groups[0]!.lines.map((l) => l.lineId)).toEqual(['a', 'c'])
  })

  it('si el precio cambió entre rondas, se ven por separado', () => {
    const groups = groupLines([...lines, line({ lineId: 'd', unitPrice: 5000, qty: 1 })])
    expect(groups.filter((g) => g.productId === 'aguila')).toHaveLength(2)
  })

  it('los renglones sin unidades activas van al final', () => {
    const groups = groupLines([line({ lineId: 'x', cancelledQty: 3 }), ...lines.slice(1, 2)])
    expect(groups.map((g) => g.productId)).toEqual(['agua', 'aguila'])
  })

  it('reparte la cancelación desde la línea más reciente', () => {
    const [g] = groupLines(lines)
    expect(splitGroupCancellation(g!, 3).map((p) => [p.line.lineId, p.qty])).toEqual([
      ['c', 2],
      ['a', 1],
    ])
    expect(() => splitGroupCancellation(g!, 5)).toThrow('Solo hay 4')
  })
})
