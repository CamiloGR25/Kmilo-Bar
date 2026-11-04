import { describe, expect, it } from 'vitest'
import {
  addBusinessDays,
  businessDateOf,
  businessDayRange,
  eachBusinessDate,
  formatBusinessDate,
  formatBusinessDateLong,
  formatDate,
  formatTime,
  isBusinessDate,
  monthRangeOf,
  weekRangeOf,
} from '@/domain/dates'

/** Instante a partir de una hora local de Bogotá (UTC−5). */
const bogota = (iso: string) => new Date(`${iso}-05:00`)

describe('businessDateOf (D-104: corte a las 06:00)', () => {
  it('a las 05:59 pertenece a la jornada anterior', () => {
    expect(businessDateOf(bogota('2026-11-08T05:59:59'))).toBe('2026-11-07')
  })
  it('a las 06:00 empieza la nueva jornada', () => {
    expect(businessDateOf(bogota('2026-11-08T06:00:00'))).toBe('2026-11-08')
  })
  it('una venta a la 1:30 a. m. del sábado es del viernes', () => {
    expect(businessDateOf(bogota('2026-11-07T01:30:00'))).toBe('2026-11-06')
  })
  it('no depende de la zona horaria del equipo (instante en UTC)', () => {
    // 2026-11-08T10:30Z = 05:30 en Bogotá → jornada del 7
    expect(businessDateOf(new Date('2026-11-08T10:30:00Z'))).toBe('2026-11-07')
  })
  it('cruza el fin de mes y de año', () => {
    expect(businessDateOf(bogota('2027-01-01T03:00:00'))).toBe('2026-12-31')
  })
})

describe('businessDayRange', () => {
  it('va de 06:00 a 06:00 del día siguiente (hora de Bogotá)', () => {
    const { start, end } = businessDayRange('2026-11-07')
    expect(start.toISOString()).toBe('2026-11-07T11:00:00.000Z')
    expect(end.toISOString()).toBe('2026-11-08T11:00:00.000Z')
  })
})

describe('rangos', () => {
  it('semana de lunes a domingo', () => {
    expect(weekRangeOf('2026-11-07')).toEqual({ from: '2026-11-02', to: '2026-11-08' })
  })
  it('mes calendario', () => {
    expect(monthRangeOf('2026-02-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })
  it('suma días y enumera jornadas', () => {
    expect(addBusinessDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(eachBusinessDate({ from: '2026-11-29', to: '2026-12-02' })).toEqual([
      '2026-11-29',
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
    ])
  })
  it('valida el formato de jornada', () => {
    expect(isBusinessDate('2026-11-07')).toBe(true)
    expect(isBusinessDate('2026-02-30')).toBe(false)
    expect(isBusinessDate('07/11/2026')).toBe(false)
    expect(() => addBusinessDays('2026-13-01', 1)).toThrow(RangeError)
  })
})

describe('formatos', () => {
  it('fecha dd/mm/aaaa y hora de 12 h en Bogotá', () => {
    const instant = bogota('2026-11-08T01:30:00')
    expect(formatDate(instant)).toBe('08/11/2026')
    expect(formatTime(instant).replace(/\u00a0/g, ' ')).toBe('1:30 a. m.')
  })
  it('etiqueta corta de jornada', () => {
    expect(formatBusinessDate('2026-11-06')).toBe('vie 06/11')
  })
  it('etiqueta larga de jornada', () => {
    expect(formatBusinessDateLong('2026-11-06')).toBe('viernes 6 de noviembre')
  })
})

describe('formatTime p. m.', () => {
  it('usa p. m. desde el mediodía', () => {
    expect(formatTime(bogota('2026-11-07T12:05:00')).replace(/\u00a0/g, ' ')).toBe('12:05 p. m.')
    expect(formatTime(bogota('2026-11-07T23:45:00')).replace(/\u00a0/g, ' ')).toBe('11:45 p. m.')
  })
})
