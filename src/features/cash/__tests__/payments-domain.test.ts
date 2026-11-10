import { describe, expect, it } from 'vitest'
import {
  cashDifference,
  allocatePlan,
  cashSuggestions,
  expectedCash,
  planCashMovement,
  planCashPayment,
  planMethodCorrection,
  planTransferPayment,
  sessionTotals,
  validateClosing,
} from '../domain/payments'

describe('planCashPayment (R-PAG-02)', () => {
  it('con billete mayor abona el saldo y calcula el cambio', () => {
    expect(planCashPayment(13_500, 20_000)).toMatchObject({
      method: 'efectivo',
      amount: 13_500,
      tendered: 20_000,
      change: 6_500,
      balanceAfter: 0,
    })
  })
  it('con menos que el saldo es un pago parcial sin cambio', () => {
    expect(planCashPayment(13_500, 10_000)).toMatchObject({
      amount: 10_000,
      change: 0,
      balanceAfter: 3_500,
    })
  })
  it('rechaza montos vacíos, cero o sin saldo', () => {
    expect(() => planCashPayment(13_500, null)).toThrow('Escribe cuánto')
    expect(() => planCashPayment(13_500, 0)).toThrow('Escribe cuánto')
    expect(() => planCashPayment(0, 5_000)).toThrow('no tiene saldo')
  })
})

describe('planTransferPayment (R-PAG-01/02)', () => {
  it('exige canal y no permite pagar de más', () => {
    expect(() => planTransferPayment(10_000, 10_000, null, null)).toThrow('Elige')
    expect(() => planTransferPayment(10_000, 12_000, 'nequi', null)).toThrow('no puede superar')
  })
  it('acepta parcial y limpia la referencia', () => {
    expect(planTransferPayment(10_000, 4_000, 'breb_qr_llave', '  ABC123 ')).toMatchObject({
      method: 'transferencia',
      channel: 'breb_qr_llave',
      amount: 4_000,
      tendered: null,
      change: 0,
      reference: 'ABC123',
      balanceAfter: 6_000,
    })
    expect(planTransferPayment(10_000, 10_000, 'nequi', '   ').reference).toBeNull()
  })
})

describe('cashSuggestions', () => {
  it('propone el exacto y los billetes que lo cubren, sin repetir', () => {
    expect(cashSuggestions(13_500)).toEqual([13_500, 20_000, 50_000, 100_000])
    expect(cashSuggestions(20_000)).toEqual([20_000, 50_000, 100_000])
    expect(cashSuggestions(0)).toEqual([])
  })
})

describe('planMethodCorrection (D-219)', () => {
  it('de efectivo a transferencia: sin efectivo ni cambio', () => {
    expect(
      planMethodCorrection(
        { method: 'efectivo', channel: null, amount: 9_000 },
        'transferencia',
        'nequi',
      ),
    ).toEqual({
      method: 'transferencia',
      channel: 'nequi',
      tendered: null,
      change: 0,
      correctedFrom: { method: 'efectivo', channel: null },
    })
  })
  it('a efectivo: recibido justo', () => {
    expect(
      planMethodCorrection(
        { method: 'transferencia', channel: 'banco', amount: 9_000 },
        'efectivo',
        null,
      ),
    ).toMatchObject({ method: 'efectivo', channel: null, tendered: 9_000, change: 0 })
  })
  it('rechaza el mismo medio o transferencia sin canal', () => {
    const p = { method: 'transferencia' as const, channel: 'nequi' as const, amount: 1 }
    expect(() => planMethodCorrection(p, 'transferencia', 'nequi')).toThrow('ya está')
    expect(() => planMethodCorrection(p, 'transferencia', null)).toThrow('canal')
    expect(planMethodCorrection(p, 'transferencia', 'daviplata').channel).toBe('daviplata')
  })
})

describe('planCashMovement', () => {
  it('da signo según el tipo y la dirección', () => {
    expect(planCashMovement('entrada_extra', 'sale', 50_000, 'Base extra', 0)).toBe(50_000)
    expect(planCashMovement('retiro_dueno', 'entra', 30_000, 'Retiro', 100_000)).toBe(-30_000)
    expect(planCashMovement('correccion', 'sale', 1_000, 'Ajuste', 5_000)).toBe(-1_000)
    expect(planCashMovement('correccion', 'entra', 1_000, 'Ajuste', 0)).toBe(1_000)
  })
  it('no deja la caja en negativo y exige motivo', () => {
    expect(() => planCashMovement('retiro_dueno', 'sale', 60_000, 'Retiro', 50_000)).toThrow(
      'No hay tanto',
    )
    expect(() => planCashMovement('entrada_extra', 'entra', 1_000, 'x', 0)).toThrow('motivo')
    expect(() => planCashMovement('entrada_extra', 'entra', null, 'Base', 0)).toThrow('monto')
  })
})

describe('arqueo (R-PAG-05/06)', () => {
  // Escenario de aceptación: efectivo, transferencia, mixto y retiro.
  const payments = [
    { method: 'efectivo' as const, channel: null, amount: 13_500, change: 6_500 },
    { method: 'transferencia' as const, channel: 'nequi' as const, amount: 20_000, change: 0 },
    // Mixto: una cuenta de 30.000 pagada 10.000 en efectivo y 20.000 por Bre-B.
    { method: 'efectivo' as const, channel: null, amount: 10_000, change: 0 },
    {
      method: 'transferencia' as const,
      channel: 'breb_qr_llave' as const,
      amount: 20_000,
      change: 0,
    },
  ]
  const movements = [{ amount: 50_000 }, { amount: -30_000 }]
  const totals = sessionTotals(payments, movements)

  it('suma por medio y canal sin contar el cambio como ingreso', () => {
    expect(totals).toMatchObject({
      cash: 23_500,
      transfer: 40_000,
      change: 6_500,
      movementsIn: 50_000,
      movementsOut: 30_000,
      paymentsCount: 4,
    })
    expect(totals.byChannel).toMatchObject({ nequi: 20_000, breb_qr_llave: 20_000, banco: 0 })
  })
  it('efectivo esperado = inicial + efectivo + entradas − salidas', () => {
    // 100.000 + 23.500 + 50.000 − 30.000 = 143.500 (cálculo manual)
    expect(expectedCash(100_000, totals)).toBe(143_500)
    expect(cashDifference(143_000, 143_500)).toBe(-500)
  })
  it('valida el cierre', () => {
    expect(validateClosing(143_500, 143_500, '', 0)).toBeNull()
    expect(validateClosing(143_000, 143_500, '', 0)).toMatch('motivo')
    expect(validateClosing(143_000, 143_500, 'Faltó una moneda', 0)).toBeNull()
    expect(validateClosing(null, 143_500, '', 0)).toMatch('Escribe')
    expect(validateClosing(780_000_780, 143_500, 'x', 0)).toMatch('demasiado alto')
    expect(validateClosing(143_500, 143_500, '', 2)).toMatch('2 cuentas abiertas')
  })
})

describe('cobro de todo lo pendiente, repartido por ronda (D-230)', () => {
  const rounds = [
    { id: 'r1', pending: 9_000 },
    { id: 'r2', pending: 30_000 },
  ]

  it('efectivo: cada ronda recibe lo suyo y el cambio va con la última', () => {
    const parts = allocatePlan(planCashPayment(39_000, 50_000), rounds)
    expect(parts.map((x) => [x.roundId, x.plan.amount, x.plan.tendered, x.plan.change])).toEqual([
      ['r1', 9_000, 9_000, 0],
      ['r2', 30_000, 41_000, 11_000],
    ])
    expect(parts.reduce((n, x) => n + x.plan.change, 0)).toBe(11_000)
  })

  it('transferencia: se reparte el monto sin cambio', () => {
    const parts = allocatePlan(planTransferPayment(39_000, 20_000, 'nequi', null), rounds)
    expect(parts.map((x) => [x.roundId, x.plan.amount, x.plan.tendered, x.plan.change])).toEqual([
      ['r1', 9_000, null, 0],
      ['r2', 11_000, null, 0],
    ])
  })

  it('no reparte más de lo pendiente de las rondas', () => {
    expect(() =>
      allocatePlan(planTransferPayment(39_000, 39_000, 'banco', null), [
        { id: 'r1', pending: 9_000 },
      ]),
    ).toThrow(/cambió/)
  })
})
