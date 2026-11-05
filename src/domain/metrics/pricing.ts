/**
 * Precios y rentabilidad por producto — docs/BUSINESS_RULES.md F-01, F-02, F-03.
 * Todo en enteros: dinero en COP y porcentajes en basis points.
 */
import { BP_PER_UNIT, ratioToBp, type Bp, type Cop } from '@/domain/money'

/** F-03: precio sugerido = ⌈costo × (1 + recargo) / paso⌉ × paso. Aritmética entera exacta. */
export function suggestedPrice(cost: Cop, markupBp: Bp, roundingStep: Cop): Cop {
  if (!Number.isSafeInteger(cost) || cost < 0) throw new RangeError(`Costo inválido: ${cost}`)
  if (!Number.isSafeInteger(markupBp) || markupBp < 0) {
    throw new RangeError(`Recargo inválido: ${markupBp}`)
  }
  if (!Number.isSafeInteger(roundingStep) || roundingStep <= 0) {
    throw new RangeError(`Paso de redondeo inválido: ${roundingStep}`)
  }
  const numerator = cost * (BP_PER_UNIT + markupBp)
  const denominator = BP_PER_UNIT * roundingStep
  return Math.ceil(numerator / denominator) * roundingStep
}

/** F-01: recargo sobre el costo, en bp. null si el costo es 0. */
export function markupOf(cost: Cop, price: Cop): Bp | null {
  return ratioToBp(price - cost, cost)
}

/** F-02: margen bruto sobre el precio de venta, en bp. null si el precio es 0. */
export function marginOf(cost: Cop, price: Cop): Bp | null {
  return ratioToBp(price - cost, price)
}

/** Ganancia bruta por unidad. */
export function unitProfit(cost: Cop, price: Cop): Cop {
  return price - cost
}

export type PricingMode = 'auto' | 'manual'

export interface PricingInput {
  cost: Cop
  pricingMode: PricingMode
  /** Recargo propio del producto; null = usa el recargo general. */
  markupBp: Bp | null
  /** Precio escrito a mano (solo aplica en modo manual). */
  manualPrice: Cop | null
}

export interface PricingSettings {
  globalMarkupBp: Bp
  roundingStep: Cop
}

export interface PricingResult {
  effectiveMarkupBp: Bp
  suggested: Cop
  salePrice: Cop
  markup: Bp | null
  margin: Bp | null
  profit: Cop
  /** Advertencias legibles (precio bajo el costo, margen muy bajo). */
  warnings: string[]
}

/** Margen por debajo del cual se advierte (10 %). */
export const LOW_MARGIN_BP = 1000

/** Calcula el precio de venta final y sus indicadores, a partir del modo de precio. */
export function computePricing(input: PricingInput, settings: PricingSettings): PricingResult {
  const effectiveMarkupBp = input.markupBp ?? settings.globalMarkupBp
  const suggested = suggestedPrice(input.cost, effectiveMarkupBp, settings.roundingStep)
  const salePrice =
    input.pricingMode === 'manual' && input.manualPrice !== null ? input.manualPrice : suggested

  const margin = marginOf(input.cost, salePrice)
  const warnings: string[] = []
  if (salePrice < input.cost) warnings.push('El precio de venta está por debajo del costo.')
  else if (margin !== null && margin < LOW_MARGIN_BP && salePrice > 0) {
    warnings.push('El margen es menor al 10 %.')
  }

  return {
    effectiveMarkupBp,
    suggested,
    salePrice,
    markup: markupOf(input.cost, salePrice),
    margin,
    profit: unitProfit(input.cost, salePrice),
    warnings,
  }
}
