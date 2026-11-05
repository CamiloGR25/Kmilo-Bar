import { useState } from 'react'
import { CalendarClock, ClipboardCheck, Loader2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { businessDateOf, formatBusinessDateLong, type BusinessDate } from '@/domain/dates'
import { useAuth } from '@/features/auth/use-auth'
import { useOpenCashSession } from '@/features/cash/services/cash-service'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'
import { reviewMessage, reviewStatus, validateSchedule, type ReviewTone } from '../domain/review'
import { scheduleReview, startReview, useInventoryReview } from '../services/review-service'
import { newOpId } from '../services/inventory-service'

const TONE: Record<ReviewTone, string> = {
  none: 'border-border',
  info: 'border-primary/50',
  warning: 'border-warning/60',
  danger: 'border-destructive-solid/70',
}

const ICON_TONE: Record<ReviewTone, string> = {
  none: 'text-muted-foreground',
  info: 'text-primary-text',
  warning: 'text-warning',
  danger: 'text-destructive',
}

/** Estado de la revisión y acciones compartidas por el aviso y el botón (R-INV-11). */
function useReview() {
  const now = useNow(60_000)
  const today = businessDateOf(now)
  const navigate = useNavigate()
  const { user } = useAuth()
  const review = useInventoryReview()
  const cash = useOpenCashSession()
  const [starting, setStarting] = useState(false)
  const s = review.data
  const st = s ? reviewStatus(s, today) : null

  async function start() {
    setStarting(true)
    try {
      await startReview(user?.uid ?? '', newOpId())
      navigate('/inventario/conteo')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  return { s, st, today, cashOpen: Boolean(cash.data), starting, start }
}

/**
 * Acciones de la revisión: programar o cambiar el día, empezar (solo con la caja cerrada) o
 * continuar el conteo en curso.
 */
function ReviewActions({
  review: { s, st, today, cashOpen, starting, start },
  emphasizeStart,
  withSchedule = true,
}: {
  review: ReturnType<typeof useReview>
  emphasizeStart?: boolean
  /** En la ventana del botón el día se programa en la misma ventana. */
  withSchedule?: boolean
}) {
  const [scheduling, setScheduling] = useState(false)
  if (!s || !st) return null
  if (st.kind === 'en_curso') {
    return (
      <Button asChild>
        <Link to="/inventario/conteo">
          <ClipboardCheck aria-hidden />
          Continuar el conteo
        </Link>
      </Button>
    )
  }
  return (
    <>
      {withSchedule && (
        <Button variant="outline" onClick={() => setScheduling(true)}>
          {s.scheduledDate ? 'Cambiar el día' : 'Programar el día'}
        </Button>
      )}
      <Button
        variant={emphasizeStart ? 'default' : 'outline'}
        disabled={cashOpen || starting}
        onClick={start}
      >
        {starting ? (
          <Loader2 aria-hidden className="animate-spin" />
        ) : (
          <ClipboardCheck aria-hidden />
        )}
        Empezar revisión
      </Button>
      <ScheduleDialog
        open={scheduling}
        onOpenChange={setScheduling}
        today={today}
        current={s.scheduledDate}
        dueDate={st.dueDate}
      />
    </>
  )
}

const CASH_NOTE = 'Para empezar, primero cierra la caja: no se cuenta mientras se vende.'

/**
 * Aviso de la revisión de inventario (R-INV-11, D-222): solo aparece cuando hay algo que hacer
 * (programar, recordatorio, hoy, vencida o en curso). Se usa en Inicio y en Inventario.
 */
export function ReviewPanel() {
  const review = useReview()
  const { s, st, cashOpen } = review
  if (!s || !st || st.tone === 'none' || st.kind === 'programada') return null
  const urgent = st.kind === 'hoy' || st.kind === 'vencida'

  return (
    <section
      aria-label="Revisión de inventario"
      className={cn(
        'flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border bg-card px-5 py-4',
        TONE[st.tone],
      )}
    >
      <CalendarClock aria-hidden className={cn('size-6 shrink-0', ICON_TONE[st.tone])} />
      <div className="min-w-0 flex-1 basis-64">
        <p className="font-medium">{reviewMessage(s, st)}</p>
        {cashOpen && urgent && <p className="text-meta text-subtle-foreground">{CASH_NOTE}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <ReviewActions review={review} emphasizeStart={urgent} />
      </div>
    </section>
  )
}

/** Botón "Revisión de inventario" del encabezado de Inventario, con los días que faltan (D-222). */
export function ReviewButton() {
  const review = useReview()
  const [open, setOpen] = useState(false)
  const { s, st, cashOpen } = review
  if (!s || !st) return null

  const hint =
    st.kind === 'en_curso'
      ? 'en curso'
      : st.kind === 'hoy'
        ? 'hoy'
        : st.daysToDue < 0
          ? 'vencida'
          : `en ${st.daysToDue} ${st.daysToDue === 1 ? 'día' : 'días'}`

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <CalendarClock aria-hidden className={ICON_TONE[st.tone]} />
        Revisión de inventario
        <span
          className={cn(
            'text-meta font-normal',
            st.tone === 'none' ? 'text-muted-foreground' : ICON_TONE[st.tone],
          )}
        >
          {hint}
        </span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-title">Revisión de inventario</DialogTitle>
            <DialogDescription className="text-label">
              Cada {s.periodMonths} meses se cuentan todos los productos, con la caja cerrada.
              Escoge un día flojo o temprano, antes de abrir.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <p className="font-medium">{reviewMessage(s, st)}</p>
            <p className="text-label text-muted-foreground">
              Última revisión: {formatBusinessDateLong(s.lastReviewDate)}.
            </p>
          </div>
          {st.kind !== 'en_curso' && (
            <ScheduleForm
              key={s.scheduledDate ?? ''}
              today={review.today}
              current={s.scheduledDate}
            />
          )}
          {cashOpen && st.kind !== 'en_curso' && (
            <p className="text-meta text-subtle-foreground">{CASH_NOTE}</p>
          )}
          <DialogFooter className="flex-wrap gap-2">
            <ReviewActions
              review={review}
              withSchedule={false}
              emphasizeStart={st.kind === 'hoy' || st.kind === 'vencida'}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Escoger, cambiar o quitar el día de la revisión. */
function ScheduleForm({
  today,
  current,
  onSaved,
}: {
  today: BusinessDate
  current: BusinessDate | null
  onSaved?: () => void
}) {
  const { user } = useAuth()
  const [date, setDate] = useState(current ?? '')
  const [pending, setPending] = useState(false)
  const error = date ? validateSchedule(date, today) : null

  async function save(value: string | null) {
    setPending(true)
    try {
      await scheduleReview(user?.uid ?? '', value)
      toast.success(
        value
          ? `Revisión programada para el ${formatBusinessDateLong(value)}`
          : 'Se quitó el día programado',
      )
      onSaved?.()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-raised/50 p-4">
      <Label htmlFor="review-date">Día de la revisión</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="review-date"
          type="date"
          min={today}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-invalid={Boolean(error)}
          className="w-auto flex-1 basis-40"
        />
        <Button
          disabled={pending || !date || Boolean(error) || date === current}
          onClick={() => save(date)}
        >
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          {current ? 'Cambiar' : 'Programar'}
        </Button>
        {current && (
          <Button variant="outline" disabled={pending} onClick={() => save(null)}>
            Quitar
          </Button>
        )}
      </div>
      {error ? (
        <p className="text-label text-destructive">{error}</p>
      ) : date ? (
        <p className="text-label text-muted-foreground first-letter:uppercase">
          {formatBusinessDateLong(date)}
        </p>
      ) : null}
    </div>
  )
}

function ScheduleDialog({
  open,
  onOpenChange,
  today,
  current,
  dueDate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  today: BusinessDate
  current: BusinessDate | null
  dueDate: BusinessDate
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-title">Programar la revisión de inventario</DialogTitle>
          <DialogDescription className="text-label">
            Escoge un día sin mucho movimiento o temprano, antes de abrir. Debe hacerse con la caja
            cerrada. Vence el {formatBusinessDateLong(dueDate)}.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <ScheduleForm today={today} current={current} onSaved={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}
