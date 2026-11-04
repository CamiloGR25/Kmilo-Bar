/**
 * Dinero y porcentajes — convenciones numéricas de docs/BUSINESS_RULES.md.
 *
 * - Montos: enteros en COP (sin decimales).
 * - Porcentajes: enteros en basis points (1 % = 100 bp).
 * - Redondeo: a peso entero, mitad alejándose de cero.
 */
import { CURRENCY, LOCALE } from '@/config/constants'

/** Monto entero en pesos colombianos. */
export type Cop = number

/** Porcentaje en basis points (1 % = 100 bp, 100 % = 10 000 bp). */
export type Bp = number

export const BP_PER_UNIT = 10_000

export class MoneyError extends Error {
  override name = 'MoneyError'
}

export function isCop(value: unknown): value is Cop {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

export function assertCop(value: number, label = 'monto'): Cop {
  if (!isCop(value)) {
    throw new MoneyError(`El ${label} debe ser un entero en COP; se recibió ${value}`)
  }
  return value
}

/** Redondea al entero más cercano; la mitad se aleja de cero (2,5 → 3; −2,5 → −3). */
export function roundHalfAwayFromZero(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value))
}

/** Suma montos en COP validando que todos sean enteros. */
export function sumCop(values: readonly Cop[]): Cop {
  return values.reduce<Cop>((acc, v) => acc + assertCop(v), 0)
}

/** Aplica un porcentaje en bp a un monto: applyBp(3000, 5000) = 1500. */
export function applyBp(amount: Cop, bp: Bp): Cop {
  assertCop(amount)
  assertBp(bp)
  return roundHalfAwayFromZero((amount * bp) / BP_PER_UNIT)
}

/** Redondea hacia arriba al múltiplo de `step` (D-106): roundUpToStep(4320, 100) = 4400. */
export function roundUpToStep(amount: Cop, step: Cop): Cop {
  assertCop(amount)
  if (!Number.isSafeInteger(step) || step <= 0) {
    throw new MoneyError(`El paso de redondeo debe ser un entero positivo; se recibió ${step}`)
  }
  return Math.ceil(amount / step) * step
}

// ---------------------------------------------------------------------------
// Basis points
// ---------------------------------------------------------------------------

export function assertBp(value: number): Bp {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`El porcentaje debe ser un entero en basis points; se recibió ${value}`)
  }
  return value
}

/** 50 → 5000 bp; 33.33 → 3333 bp. */
export function percentToBp(percent: number): Bp {
  if (!Number.isFinite(percent)) throw new MoneyError(`Porcentaje inválido: ${percent}`)
  return roundHalfAwayFromZero(percent * 100)
}

/** 5000 bp → 50. */
export function bpToPercent(bp: Bp): number {
  return assertBp(bp) / 100
}

/** Razón a bp redondeada: ratioToBp(1500, 4500) = 3333. Devuelve null si el denominador es 0. */
export function ratioToBp(numerator: number, denominator: number): Bp | null {
  if (denominator === 0) return null
  return roundHalfAwayFromZero((numerator / denominator) * BP_PER_UNIT)
}

// ---------------------------------------------------------------------------
// Formato y lectura
// ---------------------------------------------------------------------------

const copFormatter = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const percentFormatter = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

/** 45000 → "$ 45.000" (el espacio es de no separación, como lo produce Intl). */
export function formatCop(amount: Cop): string {
  return copFormatter.format(assertCop(amount))
}

/** 3333 bp → "33,3 %". */
export function formatBp(bp: Bp): string {
  return `${percentFormatter.format(bpToPercent(bp))} %`
}

/**
 * Lee lo que el usuario escribe en un campo de dinero: "$ 45.000", "45000", "45.000" → 45000.
 * Los puntos son separadores de miles. Devuelve null si no es un entero válido.
 * Las comas decimales se rechazan (COP no usa centavos).
 */
export function parseCopInput(input: string): Cop | null {
  const cleaned = input.replace(/[\s $]/g, '').replace(/\./g, '')
  if (cleaned === '' || !/^-?\d+$/.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isSafeInteger(value) ? value : null
}
