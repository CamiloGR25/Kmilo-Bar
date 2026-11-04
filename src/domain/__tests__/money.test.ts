import { describe, expect, it } from 'vitest'
import {
  MoneyError,
  applyBp,
  bpToPercent,
  formatBp,
  formatCop,
  parseCopInput,
  percentToBp,
  ratioToBp,
  roundHalfAwayFromZero,
  roundUpToStep,
  sumCop,
} from '@/domain/money'

const nbsp = (s: string) => s.replace(/\u00a0/g, ' ')

describe('formatCop', () => {
  it('formatea pesos sin decimales con punto de miles', () => {
    expect(nbsp(formatCop(45000))).toBe('$ 45.000')
    expect(nbsp(formatCop(1250000))).toBe('$ 1.250.000')
    expect(nbsp(formatCop(0))).toBe('$ 0')
  })
  it('rechaza montos no enteros', () => {
    expect(() => formatCop(10.5)).toThrow(MoneyError)
  })
})

describe('parseCopInput', () => {
  it.each([
    ['45.000', 45000],
    ['$ 45.000', 45000],
    ['45000', 45000],
    ['  1.250.000 ', 1250000],
  ])('"%s" → %d', (input, expected) => {
    expect(parseCopInput(input)).toBe(expected)
  })
  it.each(['', 'abc', '45,5', '4.5x'])('"%s" → null', (input) => {
    expect(parseCopInput(input)).toBeNull()
  })
})

describe('basis points', () => {
  it('convierte porcentaje ↔ bp', () => {
    expect(percentToBp(50)).toBe(5000)
    expect(percentToBp(33.33)).toBe(3333)
    expect(bpToPercent(5000)).toBe(50)
  })
  it('aplica bp a un monto con redondeo a peso', () => {
    expect(applyBp(3000, 5000)).toBe(1500)
    expect(applyBp(4321, 1000)).toBe(432) // 432,1
    expect(applyBp(4325, 1000)).toBe(433) // 432,5 → 433
  })
  it('calcula razones en bp y protege la división por cero', () => {
    expect(ratioToBp(1500, 4500)).toBe(3333) // margen 33,33 %
    expect(ratioToBp(1, 0)).toBeNull()
  })
  it('formatea bp con un decimal', () => {
    expect(nbsp(formatBp(3333))).toBe('33,3 %')
  })
})

describe('redondeo', () => {
  it('redondea la mitad alejándose de cero', () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3)
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3)
  })
  it('D-106: redondea hacia arriba al múltiplo de $100', () => {
    expect(roundUpToStep(4320, 100)).toBe(4400)
    expect(roundUpToStep(4400, 100)).toBe(4400)
    expect(roundUpToStep(4501, 100)).toBe(4600)
  })
  it('ejemplo de referencia: costo 3.000 + markup 50 % → 4.500', () => {
    const cost = 3000
    expect(roundUpToStep(cost + applyBp(cost, 5000), 100)).toBe(4500)
  })
  it('rechaza pasos inválidos', () => {
    expect(() => roundUpToStep(100, 0)).toThrow(MoneyError)
  })
})

describe('sumCop', () => {
  it('suma enteros y rechaza decimales', () => {
    expect(sumCop([1000, 2500, 500])).toBe(4000)
    expect(() => sumCop([1000, 0.5])).toThrow(MoneyError)
  })
})
