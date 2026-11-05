import { describe, expect, it } from 'vitest'
import {
  reviewDueDate,
  reviewMessage,
  reviewStatus,
  validateSchedule,
  type InventoryReviewState,
} from '../domain/review'

const state = (over: Partial<InventoryReviewState> = {}): InventoryReviewState => ({
  periodMonths: 4,
  lastReviewDate: '2026-11-05',
  scheduledDate: null,
  inProgressId: null,
  startedAt: null,
  ...over,
})

describe('revisión de inventario cada 4 meses (R-INV-11)', () => {
  it('vence 4 meses después de la última', () => {
    expect(reviewDueDate(state())).toBe('2027-03-05')
  })

  it('al día mientras faltan más de 15 días', () => {
    expect(reviewStatus(state(), '2027-02-17').kind).toBe('al_dia')
  })

  it('desde 15 días antes pide programar el día', () => {
    const st = reviewStatus(state(), '2027-02-18')
    expect(st).toMatchObject({ kind: 'programar', tone: 'warning', daysToDue: 15 })
    expect(reviewMessage(state(), st)).toMatch(/Programa la revisión/)
  })

  it('programada: recuerda 3 días antes, el día anterior y el mismo día', () => {
    const s = state({ scheduledDate: '2027-03-01' })
    expect(reviewStatus(s, '2027-02-20').kind).toBe('programada')
    expect(reviewStatus(s, '2027-02-26')).toMatchObject({ kind: 'recordatorio', tone: 'warning' })
    expect(reviewMessage(s, reviewStatus(s, '2027-02-28'))).toMatch(/mañana/)
    expect(reviewStatus(s, '2027-03-01')).toMatchObject({ kind: 'hoy', tone: 'danger' })
  })

  it('si el día programado pasó sin revisión, vuelve a pedir otro', () => {
    const s = state({ scheduledDate: '2027-03-01' })
    const st = reviewStatus(s, '2027-03-02')
    expect(st.kind).toBe('programar')
    expect(reviewMessage(s, st)).toMatch(/no se hizo/)
  })

  it('vencida en rojo, aunque esté programada más adelante', () => {
    expect(reviewStatus(state(), '2027-03-06')).toMatchObject({ kind: 'vencida', tone: 'danger' })
    const s = state({ scheduledDate: '2027-03-10' })
    expect(reviewStatus(s, '2027-03-06').kind).toBe('vencida')
    expect(reviewMessage(s, reviewStatus(s, '2027-03-06'))).toMatch(/programada/)
  })

  it('en curso tiene prioridad', () => {
    expect(reviewStatus(state({ inProgressId: 'r1' }), '2027-04-01').kind).toBe('en_curso')
  })

  it('el día programado debe ser hoy o futuro', () => {
    expect(validateSchedule('2026-11-05', '2026-11-05')).toBeNull()
    expect(validateSchedule('2026-11-04', '2026-11-05')).toMatch(/futura/)
    expect(validateSchedule(null, '2026-11-05')).toMatch(/Escoge/)
  })
})
