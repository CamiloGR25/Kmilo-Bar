import { describe, expect, it } from 'vitest'
import {
  computePricing,
  marginOf,
  markupOf,
  suggestedPrice,
  unitProfit,
} from '@/domain/metrics/pricing'

const settings = { globalMarkupBp: 5000, roundingStep: 100 }

describe('F-03 precio sugerido', () => {
  it('caso de referencia: costo 3.000 con 50 % → 4.500', () => {
    expect(suggestedPrice(3000, 5000, 100)).toBe(4500)
  })
  it('redondea hacia arriba al paso configurado', () => {
    expect(suggestedPrice(2880, 5000, 100)).toBe(4400) // 4.320 → 4.400
    expect(suggestedPrice(2880, 5000, 500)).toBe(4500)
    expect(suggestedPrice(2880, 5000, 1000)).toBe(5000)
  })
  it('es exacto con fracciones (sin errores de punto flotante)', () => {
    expect(suggestedPrice(3333, 5000, 100)).toBe(5000) // 4.999,5 → 5.000
    expect(suggestedPrice(1000, 1000, 100)).toBe(1100) // exacto, no sube a 1.200
  })
  it('recargo 0 con costo exacto no cambia el precio', () => {
    expect(suggestedPrice(2000, 0, 100)).toBe(2000)
  })
  it('rechaza valores inválidos', () => {
    expect(() => suggestedPrice(-1, 5000, 100)).toThrow(RangeError)
    expect(() => suggestedPrice(100, -5, 100)).toThrow(RangeError)
    expect(() => suggestedPrice(100, 5000, 0)).toThrow(RangeError)
  })
})

describe('F-01, F-02 y ganancia', () => {
  it('distingue recargo (sobre costo) de margen (sobre precio)', () => {
    expect(markupOf(3000, 4500)).toBe(5000) // 50 %
    expect(marginOf(3000, 4500)).toBe(3333) // 33,33 %
    expect(unitProfit(3000, 4500)).toBe(1500)
  })
  it('protege la división por cero', () => {
    expect(markupOf(0, 1000)).toBeNull()
    expect(marginOf(0, 0)).toBeNull()
  })
})

describe('computePricing', () => {
  it('modo automático usa el recargo general', () => {
    const r = computePricing(
      { cost: 3000, pricingMode: 'auto', markupBp: null, manualPrice: null },
      settings,
    )
    expect(r).toMatchObject({ effectiveMarkupBp: 5000, suggested: 4500, salePrice: 4500 })
    expect(r.warnings).toEqual([])
  })
  it('un recargo propio reemplaza al general', () => {
    const r = computePricing(
      { cost: 3000, pricingMode: 'auto', markupBp: 10000, manualPrice: null },
      settings,
    )
    expect(r.salePrice).toBe(6000)
  })
  it('modo manual respeta el precio escrito y calcula su margen real', () => {
    const r = computePricing(
      { cost: 3000, pricingMode: 'manual', markupBp: null, manualPrice: 5000 },
      settings,
    )
    expect(r).toMatchObject({ suggested: 4500, salePrice: 5000, margin: 4000, profit: 2000 })
  })
  it('advierte precio bajo el costo y margen bajo', () => {
    const below = computePricing(
      { cost: 3000, pricingMode: 'manual', markupBp: null, manualPrice: 2500 },
      settings,
    )
    expect(below.warnings[0]).toMatch(/por debajo del costo/)
    const low = computePricing(
      { cost: 3000, pricingMode: 'manual', markupBp: null, manualPrice: 3200 },
      settings,
    )
    expect(low.warnings[0]).toMatch(/menor al 10 %/)
  })
})
