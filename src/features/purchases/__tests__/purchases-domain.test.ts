import { describe, expect, it } from 'vitest'
import { lineTotal, newLine, toDraft } from '../domain/editable-lines'
import {
  chunk,
  costStatsBySupplier,
  describeQty,
  orderText,
  paymentStatusOf,
  pendingByProduct,
  planReception,
  statusAfterReception,
  supplierTotals,
  unitCostFromPack,
  validateLines,
  validateSupplierPayment,
  type PurchaseLine,
  type PurchaseOrder,
} from '../domain/purchases'
import type { Product } from '@/features/products/domain/catalog'

const line = (over: Partial<PurchaseLine> = {}): PurchaseLine => ({
  lineId: 'l1',
  productId: 'aguila',
  nameSnap: 'Águila',
  qtyOrdered: 20,
  qtyReceived: 0,
  estUnitCost: 2_400,
  addedAt: 1,
  ...over,
})

const order = (over: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: 'o1',
  number: 1,
  kind: 'pedido',
  supplierId: 's1',
  supplierName: 'Distribuidora',
  status: 'solicitado',
  shortClosed: false,
  lines: [line()],
  estTotal: 48_000,
  receivedTotal: 0,
  paidTotal: 0,
  paymentStatus: 'pendiente',
  expectedDate: null,
  notes: '',
  createdAt: null,
  requestedAt: null,
  closedAt: null,
  ...over,
})

const product = (over: Partial<Product> = {}): Product => ({
  id: 'aguila',
  name: 'Águila',
  description: '',
  categoryId: 'cervezas',
  unit: 'botella',
  stock: 0,
  minStock: 24,
  avgCost: 2_400,
  lastPurchaseCost: 2_400,
  salePrice: 4_500,
  pricingMode: 'auto',
  markupBp: null,
  active: true,
  supplierId: null,
  purchaseUnit: 'Canasta',
  unitsPerPurchase: 30,
  createdAt: null,
  updatedAt: null,
  ...over,
})

describe('unidad de compra (D-223 #2)', () => {
  it('costo por unidad desde la canasta, al peso', () => {
    expect(unitCostFromPack(72_000, 30)).toBe(2_400)
    expect(unitCostFromPack(70_000, 30)).toBe(2_333)
  })
  it('describe cantidades en canastas', () => {
    const c = { name: 'Canasta', units: 30 }
    expect(describeQty(60, c)).toBe('2 canastas (60 unidades)')
    expect(describeQty(65, c)).toBe('65 unidades (2 canastas + 5)')
    expect(describeQty(10, c)).toBe('10 unidades')
    expect(describeQty(1, null)).toBe('1 unidad')
  })
  it('una línea escrita en canastas se guarda en unidades', () => {
    const l = newLine(product(), 2_400)
    expect(l.mode).toBe('pack')
    const draft = toDraft({ ...l, qty: 2, cost: 72_000 })
    expect(draft).toMatchObject({ qty: 60, estUnitCost: 2_400 })
    expect(lineTotal({ ...l, qty: 2, cost: 72_000 })).toBe(144_000)
  })
  it('una cantidad que no es canasta exacta se muestra en unidades', () => {
    const l = newLine(product(), 2_400, 45)
    expect(l).toMatchObject({ mode: 'unidad', qty: 45, cost: 2_400 })
  })
})

describe('pedidos (R-COM-01)', () => {
  it('valida las líneas', () => {
    expect(validateLines([])).toMatch(/Agrega/)
    const ok = { productId: 'a', name: 'A', qty: 2, estUnitCost: 100 }
    expect(validateLines([ok])).toBeNull()
    expect(validateLines([ok, ok])).toMatch(/repetido/)
    expect(validateLines([{ ...ok, qty: 0 }])).toMatch(/cantidad/)
    expect(validateLines([{ ...ok, estUnitCost: null }])).toMatch(/costo/)
  })
  it('20 pedidas y 15 recibidas → parcial con 5 pendientes', () => {
    const lines = [line({ qtyReceived: 15 })]
    expect(statusAfterReception(lines)).toBe('parcial')
    expect(pendingByProduct([order({ status: 'parcial', lines })]).get('aguila')).toBe(5)
    expect(statusAfterReception([line({ qtyReceived: 20 })])).toBe('recibido')
  })
  it('lo pendiente no cuenta en pedidos cerrados, cancelados o en borrador', () => {
    expect(pendingByProduct([order({ status: 'borrador' })]).size).toBe(0)
    expect(pendingByProduct([order({ status: 'parcial', shortClosed: true })]).size).toBe(0)
    expect(pendingByProduct([order({ status: 'cancelado' })]).size).toBe(0)
  })
})

describe('recepción (R-COM-02…04, F-15)', () => {
  it('calcula total, variación y si llegó de más', () => {
    const o = order({
      lines: [
        line(),
        line({
          lineId: 'l2',
          productId: 'ron',
          nameSnap: 'Ron',
          qtyOrdered: 2,
          estUnitCost: 36_000,
        }),
      ],
    })
    const plan = planReception(o, [
      { lineId: 'l1', qty: 15, unitCost: 2_500 },
      { lineId: 'l2', qty: 0, unitCost: 36_000 },
    ])
    expect(plan.lines).toHaveLength(1)
    expect(plan.total).toBe(37_500)
    expect(plan.variance).toBe(1_500)
    expect(plan.hasOver).toBe(false)
    const over = planReception(o, [{ lineId: 'l1', qty: 24, unitCost: 2_400 }])
    expect(over.hasOver).toBe(true)
  })
  it('exige cantidad y costo', () => {
    expect(() => planReception(order(), [{ lineId: 'l1', qty: 0, unitCost: 2_400 }])).toThrow(
      /llegó/,
    )
    expect(() => planReception(order(), [{ lineId: 'l1', qty: 5, unitCost: null }])).toThrow(
      /costo/,
    )
    expect(() => planReception(order(), [{ lineId: 'x', qty: 5, unitCost: 1 }])).toThrow(/cambió/)
  })
  it('divide en grupos para las reglas', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
})

describe('pagos y saldos (R-COM-05)', () => {
  it('estado del pago', () => {
    expect(paymentStatusOf(48_000, 0)).toBe('pendiente')
    expect(paymentStatusOf(48_000, 20_000)).toBe('abonado')
    expect(paymentStatusOf(48_000, 48_000)).toBe('pagado')
  })
  it('no se paga más del saldo', () => {
    expect(validateSupplierPayment(10_000, 48_000)).toBeNull()
    expect(validateSupplierPayment(50_000, 48_000)).toMatch(/saldo/)
    expect(validateSupplierPayment(0, 48_000)).toMatch(/monto/)
  })
  it('saldo y total comprado por proveedor', () => {
    const t = supplierTotals([
      order({ receivedTotal: 48_000, paidTotal: 20_000, status: 'recibido' }),
      order({ id: 'o2', receivedTotal: 10_000, paidTotal: 10_000, status: 'parcial' }),
    ]).get('s1')
    expect(t).toEqual({ debt: 28_000, bought: 58_000, open: 1 })
  })
})

describe('comparación de precios (D-223 #8)', () => {
  it('último, mínimo y promedio ponderado por proveedor', () => {
    const stats = costStatsBySupplier([
      { supplierId: 'a', qty: 30, unitCost: 2_500, at: null },
      { supplierId: 'b', qty: 60, unitCost: 2_300, at: null },
      { supplierId: 'a', qty: 30, unitCost: 2_300, at: null },
    ])
    expect(stats.map((s) => s.supplierId)).toEqual(['b', 'a'])
    expect(stats[1]).toMatchObject({ last: 2_500, min: 2_300, avg: 2_400, qty: 60 })
  })
})

describe('texto del pedido (D-223 #6)', () => {
  it('lista en canastas para WhatsApp', () => {
    const text = orderText('Kmilo Bar', order({ lines: [line({ qtyOrdered: 60 })] }), () => ({
      name: 'Canasta',
      units: 30,
    }))
    expect(text).toContain('*Pedido Kmilo Bar* #1')
    expect(text).toContain('- Águila: 2 canastas (60 unidades)')
  })
})
