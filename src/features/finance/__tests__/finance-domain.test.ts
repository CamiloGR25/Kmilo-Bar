import { describe, expect, it } from 'vitest'
import { buildDayStats } from '@/domain/metrics/daily-stats'
import {
  breakEven,
  capitalStats,
  cashFlow,
  expenseStats,
  fixedMonthlyTotal,
  incomeStatement,
  merchandiseFlow,
  monthProgress,
  pendingFixed,
  recovery,
  validateAmount,
  type FixedExpense,
} from '../domain/finance'

/** Dataset de referencia: el ejemplo de la cerveza (10 canastas, 100 vendidas). */
const month = {
  salesGross: 450_000,
  cogs: 240_000,
  ordersCount: 10,
  collected: 450_000,
  orderLosses: 0,
  invLosses: 4_800,
  invGains: 0,
  supplierPaid: 720_000,
  expensesFixed: 150_000,
  expensesVariable: 20_000,
  investment: 300_000,
  capitalIn: 100_000,
  ownerWithdrawals: 50_000,
  cashExtraIn: 0,
}

describe('gastos y capital (D-226)', () => {
  it('cada tipo de gasto va a su campo', () => {
    expect(expenseStats('fijo', 100)).toEqual({ expensesFixed: 100 })
    expect(expenseStats('variable', 100)).toEqual({ expensesVariable: 100 })
    expect(expenseStats('inversion', 100)).toEqual({ investment: 100 })
    expect(expenseStats('fijo', -100)).toEqual({ expensesFixed: -100 })
  })
  it('capital: inversión inicial, aporte y retiro', () => {
    expect(capitalStats('inversion_inicial', 5)).toEqual({ initialInvestment: 5 })
    expect(capitalStats('aporte', 5)).toEqual({ capitalIn: 5 })
    expect(capitalStats('retiro', 5)).toEqual({ ownerWithdrawals: 5 })
  })
  it('valida montos', () => {
    expect(validateAmount(1000)).toBeNull()
    expect(validateAmount(0)).toMatch(/monto/)
    expect(validateAmount(null)).toMatch(/monto/)
  })
  it('gastos fijos pendientes del mes', () => {
    const fixed: FixedExpense[] = [
      { id: 'a', name: 'Arriendo', categoryId: 'arriendo', amount: 1_000_000, active: true },
      { id: 'b', name: 'Internet', categoryId: 'internet', amount: 90_000, active: true },
      { id: 'c', name: 'Viejo', categoryId: 'otros', amount: 5, active: false },
    ]
    const paid = [
      { fixedExpenseId: 'a', period: '2026-11', status: 'activo' as const },
      { fixedExpenseId: 'b', period: '2026-10', status: 'activo' as const },
    ]
    expect(pendingFixed(fixed, paid, '2026-11').map((f) => f.id)).toEqual(['b'])
    expect(fixedMonthlyTotal(fixed)).toBe(1_090_000)
  })
})

describe('estado de resultados (F-04…F-12)', () => {
  it('la mercancía se resta al venderse, no al pagarse (D-226 #10)', () => {
    const st = incomeStatement(month)
    expect(st.grossProfit).toBe(210_000)
    expect(st.losses).toBe(4_800)
    // 210.000 − 4.800 − 150.000 − 20.000: el pago de 720.000 no entra en la utilidad.
    expect(st.operatingProfit).toBe(35_200)
    expect(st.investment).toBe(300_000)
    expect(st.avgTicket).toBe(45_000)
  })
})

describe('flujo de caja (F-13)', () => {
  it('suma lo que entró y resta lo que salió', () => {
    const f = cashFlow(month)
    expect(f.inTotal).toBe(550_000)
    expect(f.outTotal).toBe(720_000 + 170_000 + 300_000 + 50_000)
    expect(f.net).toBe(550_000 - 1_240_000)
  })
})

describe('punto de equilibrio (F-16, F-17)', () => {
  it('datos insuficientes sin gastos fijos o sin ventas', () => {
    expect(breakEven(0, month).reason).toMatch(/gastos fijos/)
    expect(breakEven(100, {}).reason).toMatch(/ventas/)
  })
  it('avance del mes y lo que falta por día', () => {
    const p = monthProgress(500_000, 2_000_000, '2026-11-21')
    expect(p.progressBp).toBe(2_500)
    expect(p.missing).toBe(1_500_000)
    expect(p.daysLeft).toBe(10)
    expect(p.perDay).toBe(150_000)
  })
})

describe('recuperación de la inversión (F-18, F-19, D-226 #7)', () => {
  const day = (businessDate: string, over = {}) => ({ businessDate, ...over })
  it('arranca en negativo y sube con la utilidad desde el primer mes', () => {
    const r = recovery(
      [
        day('2026-09-01', { initialInvestment: 10_000_000 }),
        day('2026-09-15', { salesGross: 3_000_000, cogs: 1_500_000, expensesFixed: 500_000 }),
        day('2026-10-15', { salesGross: 4_000_000, cogs: 2_000_000, expensesFixed: 500_000 }),
      ],
      '2026-10-31',
    )
    expect(r.totalInvested).toBe(10_000_000)
    expect(r.totalProfit).toBe(1_000_000 + 1_500_000)
    expect(r.pending).toBe(7_500_000)
    expect(r.months.map((m) => m.pending)).toEqual([9_000_000, 7_500_000])
    expect(r.recoveredBp).toBe(2_500)
    // Promedio de 1.000.000 y 1.500.000 (octubre completo) → 1.250.000 al mes → 6 meses.
    expect(r.monthsLeft).toBe(6)
    expect(r.lowConfidence).toBe(true)
  })
  it('sin utilidad no estima', () => {
    const r = recovery(
      [day('2026-11-01', { initialInvestment: 1_000, expensesFixed: 500 })],
      '2026-11-10',
    )
    expect(r.monthsLeft).toBeNull()
    expect(r.pending).toBe(1_500)
  })
})

describe('recálculo con gastos y capital', () => {
  it('suma los extras de la jornada', () => {
    const full = buildDayStats({
      orders: [],
      payments: [],
      movements: [],
      extra: [expenseStats('fijo', 100), capitalStats('aporte', 50), { cashExtraIn: 20 }],
    })
    expect(full).toMatchObject({ expensesFixed: 100, capitalIn: 50, cashExtraIn: 20 })
  })
})

describe('inventario y mercancía (D-227)', () => {
  it('compras, vendido a costo, stock y ganancia potencial', () => {
    const f = merchandiseFlow(
      [
        { purchases: 720_000, cogs: 240_000, salesGross: 450_000 },
        { purchases: 0, cogs: 100_000, salesGross: 200_000 },
      ],
      [
        { stock: 200, avgCost: 2_400, salePrice: 4_500 },
        { stock: 0, avgCost: 0, salePrice: 0 },
      ],
    )
    expect(f.purchased).toBe(720_000)
    expect(f.soldCost).toBe(340_000)
    expect(f.soldSales).toBe(650_000)
    expect(f.realizedProfit).toBe(310_000)
    expect(f.stockCost).toBe(480_000)
    expect(f.stockSale).toBe(900_000)
    expect(f.potentialProfit).toBe(420_000)
    expect(f.soldBp).toBe(4_722)
    // Vendido 340.000 + stock 480.000 = 820.000, pero solo se compraron 720.000:
    // los 100.000 de diferencia son inventario inicial (o sobrantes ajustados).
    expect(f.otherMoves).toBe(100_000)
  })
  it('sin compras no calcula el porcentaje vendido', () => {
    expect(merchandiseFlow([], []).soldBp).toBeNull()
  })
})
