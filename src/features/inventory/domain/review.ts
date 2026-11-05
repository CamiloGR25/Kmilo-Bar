/**
 * Revisión de inventario periódica — BUSINESS_RULES R-INV-11 (D-220, D-221).
 * Cada `periodMonths` meses se hace un conteo físico completo, en un día programado por el
 * usuario y con la caja cerrada. Lógica pura: calcula qué aviso mostrar.
 */
import {
  addBusinessMonths,
  daysBetween,
  formatBusinessDateLong,
  formatTime,
  type BusinessDate,
} from '@/domain/dates'

export const DEFAULT_REVIEW_MONTHS = 4
/** Días antes del vencimiento en que se pide programar el día. */
export const SCHEDULE_WINDOW_DAYS = 15
/** Días antes del día programado en que empiezan los recordatorios. */
export const REMINDER_DAYS = 3

export interface InventoryReviewState {
  periodMonths: number
  lastReviewDate: BusinessDate
  scheduledDate: BusinessDate | null
  inProgressId: string | null
  startedAt: Date | null
}

export type ReviewKind =
  | 'al_dia' // falta para programar
  | 'programar' // dentro de la ventana y sin día programado (o el día programado ya pasó)
  | 'programada' // con día programado, todavía lejos
  | 'recordatorio' // faltan 1–3 días para el día programado
  | 'hoy' // hoy es el día programado
  | 'vencida' // pasó la fecha límite sin revisión
  | 'en_curso'

export type ReviewTone = 'none' | 'info' | 'warning' | 'danger'

export interface ReviewStatus {
  kind: ReviewKind
  tone: ReviewTone
  dueDate: BusinessDate
  /** Días hasta la fecha límite (negativo si ya venció). */
  daysToDue: number
  /** Días hasta el día programado (null si no hay). */
  daysToScheduled: number | null
}

/** Fecha límite de la próxima revisión. */
export function reviewDueDate(s: Pick<InventoryReviewState, 'lastReviewDate' | 'periodMonths'>) {
  return addBusinessMonths(s.lastReviewDate, s.periodMonths)
}

/** Estado del recordatorio para la jornada `today` (R-INV-11). */
export function reviewStatus(s: InventoryReviewState, today: BusinessDate): ReviewStatus {
  const dueDate = reviewDueDate(s)
  const daysToDue = daysBetween(today, dueDate)
  const daysToScheduled = s.scheduledDate ? daysBetween(today, s.scheduledDate) : null
  const base = { dueDate, daysToDue, daysToScheduled }

  if (s.inProgressId) return { ...base, kind: 'en_curso', tone: 'info' }
  if (daysToScheduled === 0) return { ...base, kind: 'hoy', tone: 'danger' }
  if (daysToDue < 0) return { ...base, kind: 'vencida', tone: 'danger' }
  if (daysToScheduled !== null && daysToScheduled > 0) {
    return daysToScheduled <= REMINDER_DAYS
      ? { ...base, kind: 'recordatorio', tone: 'warning' }
      : { ...base, kind: 'programada', tone: 'info' }
  }
  // Sin día programado, o el día programado ya pasó sin hacer la revisión.
  if (daysToDue <= SCHEDULE_WINDOW_DAYS || daysToScheduled !== null) {
    return { ...base, kind: 'programar', tone: 'warning' }
  }
  return { ...base, kind: 'al_dia', tone: 'none' }
}

/** Valida el día que se quiere programar: desde hoy en adelante. */
export function validateSchedule(date: BusinessDate | null, today: BusinessDate): string | null {
  if (!date) return 'Escoge el día de la revisión.'
  if (daysBetween(today, date) < 0) return 'El día debe ser hoy o una fecha futura.'
  if (daysBetween(today, date) > 366) return 'Escoge un día dentro del próximo año.'
  return null
}

const days = (n: number) => (n === 1 ? '1 día' : `${n} días`)

/** Texto del recordatorio según el estado (R-INV-11). */
export function reviewMessage(s: InventoryReviewState, st: ReviewStatus): string {
  const due = formatBusinessDateLong(st.dueDate)
  const sched = s.scheduledDate ? formatBusinessDateLong(s.scheduledDate) : null
  switch (st.kind) {
    case 'en_curso':
      return `Revisión de inventario en curso${s.startedAt ? ` desde las ${formatTime(s.startedAt)}` : ''}. No se puede abrir caja hasta terminarla.`
    case 'hoy':
      return 'Hoy toca la revisión de inventario. Hazla con la caja cerrada, antes de abrir.'
    case 'vencida':
      return `La revisión de inventario venció el ${due} (hace ${days(-st.daysToDue)}).${sched ? ` Está programada para el ${sched}.` : ' Programa un día flojo o temprano, antes de abrir.'}`
    case 'recordatorio':
      return `Revisión de inventario ${st.daysToScheduled === 1 ? 'mañana' : `en ${days(st.daysToScheduled!)}`}: ${sched}. Recuerda hacerla con la caja cerrada.`
    case 'programada':
      return `Revisión de inventario programada para el ${sched}. Vence el ${due}.`
    case 'programar':
      return s.scheduledDate
        ? `La revisión programada para el ${sched} no se hizo. Escoge otro día antes del ${due}.`
        : `Programa la revisión de inventario: vence el ${due} (faltan ${days(st.daysToDue)}). Escoge un día flojo o temprano, antes de abrir.`
    default:
      return `Próxima revisión de inventario antes del ${due} (faltan ${days(st.daysToDue)}).`
  }
}
