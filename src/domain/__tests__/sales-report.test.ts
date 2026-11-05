import { describe, expect, it } from 'vitest'
import { addBusinessMonths, daysBetween, formatHour, formatMonth, hourOf } from '@/domain/dates'
import {
  buildDayStats,
  inventoryMovementStats,
  mergeDeltas,
  paidOrderStats,
  validateRebuildRange,
} from '@/domain/metrics/daily-stats'
import {
  aggregate,
  categoryRows,
  changeBp,
  comparisonRange,
  dailySeries,
  hourSeries,
  monthlySeries,
  periodRange,
  productRows,
  shiftAnchor,
  sortRows,
  topRows,
  type DayStats,
} from '@/domain/metrics/sales-report'
import { formatCopCompact } from '@/domain/money'

const at = (iso: string) => new Date(`${iso}-05:00`)

const line = (over = {}) => ({
  productId: 'aguila',
  nameSnap: 'Águila',
  categoryIdSnap: 'cervezas',
  unitPrice: 4_500,
  unitCostSnap: 2_400,
  qty: 2,
  cancelledQty: 0,
  lostQty: 0,
  ...over,
})

describe('fechas nuevas', () => {
  it('suma meses y cuenta días', () => {
    expect(addBusinessMonths('2026-11-05', 4)).toBe('2027-03-05')
    expect(addBusinessMonths('2027-01-31', 1)).toBe('2027-02-28')
    expect(daysBetween('2026-11-05', '2026-11-20')).toBe(15)
    expect(daysBetween('2026-11-20', '2026-11-05')).toBe(-15)
  })
  it('hora en Bogotá y etiquetas', () => {
    expect(hourOf(at('2026-11-06T22:15:00'))).toBe(22)
    expect(hourOf(at('2026-11-07T01:30:00'))).toBe(1)
    expect(formatHour(22)).toBe('10 p. m.')
    expect(formatHour(0)).toBe('12 a. m.')
    expect(formatHour(12)).toBe('12 p. m.')
    expect(formatMonth('2026-11-07')).toBe('nov 2026')
  })
  it('formato compacto para ejes', () => {
    expect(formatCopCompact(1_250_000)).toBe('$ 1,3 M')
    expect(formatCopCompact(450_000)).toBe('$ 450 mil')
    expect(formatCopCompact(900)).toBe('$ 900')
  })
})

describe('estadísticas nuevas (D-221)', () => {
  it('ventas por hora según la ronda', () => {
    const d = paidOrderStats([
      line({ addedAt: at('2026-11-06T22:10:00') }),
      line({ productId: 'ron', addedAt: at('2026-11-07T01:05:00'), qty: 1, unitPrice: 9_000 }),
      line({ addedAt: null }),
    ])
    expect(d.byHour).toEqual({ '22': 9_000, '1': 9_000 })
    // Sin hora ni respaldo, la línea cuenta en ventas pero no en horas.
    expect(d.salesGross).toBe(27_000)
  })

  it('pérdidas y sobrantes de inventario (F-10)', () => {
    expect(inventoryMovementStats('merma', -2, 2_400)).toEqual({
      invLosses: 4_800,
      byLossType: { merma: 4_800 },
    })
    expect(inventoryMovementStats('conteo', -1, 2_400)).toEqual({
      invLosses: 2_400,
      byLossType: { conteo: 2_400 },
    })
    expect(inventoryMovementStats('conteo', 3, 1_000)).toEqual({ invGains: 3_000 })
    expect(inventoryMovementStats('ajuste_positivo', 1, 1_000)).toEqual({ invGains: 1_000 })
    expect(inventoryMovementStats('venta', -2, 2_400)).toEqual({})
    expect(inventoryMovementStats('entrada_manual', 24, 2_400)).toEqual({})
  })

  it('suma deltas sin perder mapas', () => {
    const m = mergeDeltas(
      { invLosses: 100, byLossType: { merma: 100 }, byHour: { '22': 5 } },
      { invLosses: 50, byLossType: { merma: 20, vencido: 30 }, byHour: { '22': 5, '23': 1 } },
      {},
    )
    expect(m).toEqual({
      invLosses: 150,
      byLossType: { merma: 120, vencido: 30 },
      byHour: { '22': 10, '23': 1 },
    })
  })

  it('recalcula un día igual que los deltas del momento', () => {
    const lines = [line({ addedAt: at('2026-11-06T22:00:00') }), line({ qty: 1, lostQty: 1 })]
    const full = buildDayStats({
      orders: [
        { status: 'pagada', closedAt: at('2026-11-06T23:00:00'), lines },
        { status: 'abierta', closedAt: null, lines: [line({ qty: 3, lostQty: 1 })] },
      ],
      payments: [{ method: 'efectivo', channel: null, amount: 9_000 }],
      movements: [{ type: 'merma', qty: -1, unitCost: 2_400 }],
    })
    expect(full.salesGross).toBe(9_000)
    expect(full.ordersCount).toBe(1)
    expect(full.collected).toBe(9_000)
    expect(full.orderLosses).toBe(4_800)
    expect(full.invLosses).toBe(2_400)
    expect(full.byHour).toEqual({ '22': 9_000 })
  })

  it('valida el rango del recálculo', () => {
    const today = '2026-11-06'
    expect(validateRebuildRange('2026-11-01', '2026-11-06', today)).toBeNull()
    expect(validateRebuildRange('2026-11-06', '2026-11-01', today)).toMatch(/anterior/)
    expect(validateRebuildRange('2026-11-01', '2026-11-07', today)).toMatch(/futuros/)
    expect(validateRebuildRange('2026-09-01', '2026-11-06', today)).toMatch(/31/)
  })
})

describe('periodos y comparación (D-221)', () => {
  it('rangos por tipo', () => {
    expect(periodRange('dia', '2026-11-06')).toEqual({ from: '2026-11-06', to: '2026-11-06' })
    expect(periodRange('semana', '2026-11-06')).toEqual({ from: '2026-11-02', to: '2026-11-08' })
    expect(periodRange('mes', '2026-11-06')).toEqual({ from: '2026-11-01', to: '2026-11-30' })
    expect(periodRange('anio', '2026-11-06')).toEqual({ from: '2025-12-01', to: '2026-11-30' })
  })
  it('compara un día con el mismo día de la semana anterior', () => {
    expect(comparisonRange('dia', { from: '2026-11-06', to: '2026-11-06' })).toEqual({
      from: '2026-10-30',
      to: '2026-10-30',
    })
    expect(comparisonRange('mes', { from: '2026-11-01', to: '2026-11-30' })).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    })
    expect(comparisonRange('rango', { from: '2026-11-05', to: '2026-11-06' })).toEqual({
      from: '2026-11-03',
      to: '2026-11-04',
    })
  })
  it('mueve el periodo', () => {
    expect(shiftAnchor('semana', '2026-11-06', -1)).toBe('2026-10-30')
    expect(shiftAnchor('mes', '2026-11-06', 1)).toBe('2026-12-06')
  })
  it('variación en bp', () => {
    expect(changeBp(120, 100)).toBe(2_000)
    expect(changeBp(80, 100)).toBe(-2_000)
    expect(changeBp(80, 0)).toBeNull()
  })
})

describe('totales, series y productos', () => {
  const days: DayStats[] = [
    {
      businessDate: '2026-11-05',
      salesGross: 10_000,
      cogs: 6_000,
      ordersCount: 2,
      orderLosses: 500,
      invLosses: 1_000,
      byHour: { '22': 10_000 },
      byProduct: {
        aguila: { name: 'Águila', categoryId: 'cervezas', qty: 2, sales: 9_000, cogs: 4_800 },
      },
      byCategory: { cervezas: { qty: 2, sales: 9_000, cogs: 4_800 } },
    },
    {
      businessDate: '2026-11-06',
      salesGross: 20_000,
      cogs: 9_000,
      ordersCount: 2,
      byHour: { '23': 20_000, '1': 1_000 },
      byProduct: {
        aguila: { name: 'Águila', categoryId: 'cervezas', qty: 1, sales: 4_500, cogs: 2_400 },
        ron: { name: 'Ron', categoryId: 'rones', qty: 1, sales: 15_500, cogs: 6_600 },
      },
      byCategory: { rones: { qty: 1, sales: 15_500, cogs: 6_600 } },
    },
  ]

  it('suma el periodo con ganancia, margen, ticket y pérdidas', () => {
    const t = aggregate(days)
    expect(t.salesGross).toBe(30_000)
    expect(t.grossProfit).toBe(15_000)
    expect(t.marginBp).toBe(5_000)
    expect(t.avgTicket).toBe(7_500)
    expect(t.losses).toBe(1_500)
    expect(t.byProduct.aguila?.qty).toBe(3)
  })

  it('series por día y por mes con ceros', () => {
    const s = dailySeries(days, { from: '2026-11-04', to: '2026-11-06' })
    expect(s.map((p) => p.sales)).toEqual([0, 10_000, 20_000])
    const m = monthlySeries(days, { from: '2026-10-01', to: '2026-11-30' })
    expect(m.map((p) => [p.key, p.sales])).toEqual([
      ['2026-10', 0],
      ['2026-11', 30_000],
    ])
  })

  it('horas en el orden de la jornada, recortadas', () => {
    const h = hourSeries(aggregate(days).byHour)
    expect(h.map((p) => p.hour)).toEqual([22, 23, 0, 1])
    expect(h[0]!.label).toBe('10 p. m.')
    expect(hourSeries({})).toEqual([])
  })

  it('tabla por producto, orden y top', () => {
    const rows = productRows(aggregate(days).byProduct)
    expect(sortRows(rows, 'profit').map((r) => r.id)).toEqual(['ron', 'aguila'])
    expect(sortRows(rows, 'name').map((r) => r.id)).toEqual(['aguila', 'ron'])
    expect(topRows(rows, 'qty', 1).map((r) => r.id)).toEqual(['aguila'])
    expect(rows.find((r) => r.id === 'ron')?.marginBp).toBe(5_742)
    expect(categoryRows(aggregate(days).byCategory).map((c) => c.id)).toEqual(['rones', 'cervezas'])
  })
})
