/**
 * Fechas del negocio — America/Bogota y jornada operativa con corte (D-104).
 *
 * Una "jornada" (businessDate, "AAAA-MM-DD") va desde las 06:00 de ese día
 * hasta las 05:59:59 del día siguiente, hora de Bogotá.
 */
import { TZDate, tz } from '@date-fns/tz'
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  format,
  parse,
  startOfMonth,
  startOfWeek,
  subHours,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { BUSINESS_DAY_CUTOFF_HOUR, TIME_ZONE } from '@/config/constants'

/** Fecha de jornada en formato "AAAA-MM-DD". */
export type BusinessDate = string

const inBogota = tz(TIME_ZONE)
const BUSINESS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isBusinessDate(value: string): value is BusinessDate {
  if (!BUSINESS_DATE_RE.test(value)) return false
  const parsed = parse(value, 'yyyy-MM-dd', new Date())
  return !Number.isNaN(parsed.getTime()) && format(parsed, 'yyyy-MM-dd') === value
}

function assertBusinessDate(value: string): BusinessDate {
  if (!isBusinessDate(value)) throw new RangeError(`Fecha de jornada inválida: "${value}"`)
  return value
}

/** Jornada a la que pertenece un instante: 2026-11-08 01:30 (Bogotá) → "2026-11-07". */
export function businessDateOf(instant: Date): BusinessDate {
  const shifted = subHours(instant, BUSINESS_DAY_CUTOFF_HOUR, { in: inBogota })
  return format(shifted, 'yyyy-MM-dd', { in: inBogota })
}

/** Instante (Date) de una fecha y hora locales de Bogotá. */
function bogotaInstant(date: BusinessDate, hour: number): Date {
  const [y, m, d] = assertBusinessDate(date).split('-').map(Number) as [number, number, number]
  return new Date(new TZDate(y, m - 1, d, hour, 0, 0, TIME_ZONE).getTime())
}

/** Intervalo [inicio, fin) de una jornada como instantes absolutos. */
export function businessDayRange(date: BusinessDate): { start: Date; end: Date } {
  const start = bogotaInstant(date, BUSINESS_DAY_CUTOFF_HOUR)
  const end = bogotaInstant(addBusinessDays(date, 1), BUSINESS_DAY_CUTOFF_HOUR)
  return { start, end }
}

/** Suma (o resta) días a una fecha de jornada. */
export function addBusinessDays(date: BusinessDate, days: number): BusinessDate {
  const parsed = parse(assertBusinessDate(date), 'yyyy-MM-dd', new Date())
  return format(addDays(parsed, days), 'yyyy-MM-dd')
}

/** Rango inclusivo de jornadas. */
export interface BusinessDateRange {
  from: BusinessDate
  to: BusinessDate
}

/** Semana (lunes a domingo) que contiene la jornada. */
export function weekRangeOf(date: BusinessDate): BusinessDateRange {
  const parsed = parse(assertBusinessDate(date), 'yyyy-MM-dd', new Date())
  const monday = startOfWeek(parsed, { weekStartsOn: 1 })
  return { from: format(monday, 'yyyy-MM-dd'), to: format(addDays(monday, 6), 'yyyy-MM-dd') }
}

/** Mes calendario que contiene la jornada. */
export function monthRangeOf(date: BusinessDate): BusinessDateRange {
  const parsed = parse(assertBusinessDate(date), 'yyyy-MM-dd', new Date())
  return {
    from: format(startOfMonth(parsed), 'yyyy-MM-dd'),
    to: format(endOfMonth(parsed), 'yyyy-MM-dd'),
  }
}

/** Suma (o resta) meses a una fecha de jornada (31 ene + 1 mes → 28/29 feb). */
export function addBusinessMonths(date: BusinessDate, months: number): BusinessDate {
  const parsed = parse(assertBusinessDate(date), 'yyyy-MM-dd', new Date())
  return format(addMonths(parsed, months), 'yyyy-MM-dd')
}

/** Días de `from` a `to` (positivo si `to` es posterior). */
export function daysBetween(from: BusinessDate, to: BusinessDate): number {
  const a = parse(assertBusinessDate(from), 'yyyy-MM-dd', new Date())
  const b = parse(assertBusinessDate(to), 'yyyy-MM-dd', new Date())
  return differenceInCalendarDays(b, a)
}

/** Hora (0–23) de un instante en Bogotá. */
export function hourOf(instant: Date): number {
  return Number(format(instant, 'H', { in: inBogota }))
}

/** Lista de jornadas de un rango inclusivo (útil para gráficas por día). */
export function eachBusinessDate({ from, to }: BusinessDateRange): BusinessDate[] {
  const result: BusinessDate[] = []
  for (let d = assertBusinessDate(from); d <= assertBusinessDate(to); d = addBusinessDays(d, 1)) {
    result.push(d)
  }
  return result
}

// ---------------------------------------------------------------------------
// Formato para la interfaz
// ---------------------------------------------------------------------------

/** "07/11/2026" en hora de Bogotá. */
export function formatDate(instant: Date): string {
  return format(instant, 'dd/MM/yyyy', { in: inBogota })
}

/** "1:30 a. m." en hora de Bogotá (P-05: 12 h). */
export function formatTime(instant: Date): string {
  const hour = Number(format(instant, 'H', { in: inBogota }))
  const suffix = hour < 12 ? 'a. m.' : 'p. m.'
  return `${format(instant, 'h:mm', { in: inBogota })} ${suffix}`
}

/** Etiqueta de una hora del día: 22 → "10 p. m.", 0 → "12 a. m.". */
export function formatHour(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12} ${hour < 12 ? 'a. m.' : 'p. m.'}`
}

/** Mes de una jornada: "2026-11-07" → "nov 2026". */
export function formatMonth(date: BusinessDate): string {
  const parsed = parse(assertBusinessDate(date), 'yyyy-MM-dd', new Date())
  return format(parsed, 'MMM yyyy', { locale: es }).replace('.', '')
}

/** "07/11/2026 1:30 a. m." */
export function formatDateTime(instant: Date): string {
  return `${formatDate(instant)} ${formatTime(instant)}`
}

/** Etiqueta corta de jornada: "2026-11-07" → "vie 07/11". */
export function formatBusinessDate(date: BusinessDate): string {
  const parsed = parse(assertBusinessDate(date), 'yyyy-MM-dd', new Date())
  return format(parsed, 'EEE dd/MM', { locale: es }).replace('.', '')
}

/** Etiqueta larga de jornada: "2026-11-06" → "viernes 6 de noviembre". */
export function formatBusinessDateLong(date: BusinessDate): string {
  const parsed = parse(assertBusinessDate(date), 'yyyy-MM-dd', new Date())
  return format(parsed, "EEEE d 'de' MMMM", { locale: es })
}
