import { useState } from 'react'
import { ArrowDownUp, Loader2, LockKeyhole, Pencil, Wallet } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { MoneyInput } from '@/components/shared/inputs'
import { Page, PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { formatBusinessDateLong, formatTime } from '@/domain/dates'
import { formatCop } from '@/domain/money'
import { FormField } from '@/features/auth/components/form-field'
import { useAuth } from '@/features/auth/use-auth'
import { DaySummaryButton } from '@/features/reports/components/day-summary-button'
import { cn } from '@/lib/utils'
import { CashError, validateOpeningBalance, type CashSession } from '../domain/cash'
import {
  CASH_MOVEMENT_LABELS,
  CHANNEL_LABELS,
  CHANNELS,
  expectedCash,
  methodLabel,
  sessionTotals,
  type Payment,
} from '../domain/payments'
import {
  openCashSession,
  useCashMovements,
  useOpenCashSession,
  useRecentCashSessions,
} from '../services/cash-service'
import { usePaymentsOfSession } from '../services/payments-service'
import { CashMovementDialog, CloseCashDialog, CorrectPaymentDialog } from './cash-dialogs'

/** Caja: apertura (Fase 4), pagos, entradas y salidas, arqueo y cierre (Fase 5, R-PAG-05/06). */
export function CashPage() {
  const open = useOpenCashSession()
  const recent = useRecentCashSessions()

  return (
    <Page>
      <PageHeader
        title="Caja"
        description="Sin caja abierta no se pueden abrir cuentas ni cobrar."
      />
      {open.loading ? (
        <div className="h-48 animate-pulse rounded-xl bg-card" />
      ) : open.error ? (
        <p role="alert" className="text-label text-destructive">
          No se pudo cargar la caja: {open.error.message}
        </p>
      ) : open.data ? (
        <OpenSessionPanel session={open.data} />
      ) : (
        <OpenCashForm />
      )}

      {recent.data && recent.data.length > 0 && (
        <section aria-labelledby="historial-caja" className="flex flex-col gap-3">
          <h2 id="historial-caja" className="text-title font-semibold">
            Historial de cierres
          </h2>
          <ul className="divide-y divide-border rounded-xl border bg-card">
            {recent.data.map((s) => (
              <SessionRow key={s.id} session={s} />
            ))}
          </ul>
        </section>
      )}
    </Page>
  )
}

function SessionRow({ session: s }: { session: CashSession }) {
  const diff = s.closing?.difference ?? 0
  const head = (
    <>
      <div>
        <p className="font-medium">Caja #{s.number}</p>
        <p className="text-meta text-subtle-foreground first-letter:uppercase">
          {formatBusinessDateLong(s.businessDate)}
        </p>
      </div>
      <div className="flex items-center gap-4">
        <span className="tabular text-label text-muted-foreground">
          {s.closing
            ? `Ventas ${formatCop(s.closing.summary.sales)}`
            : `Inicial ${formatCop(s.openingBalance)}`}
        </span>
        <span
          className={cn(
            'text-label',
            s.status === 'abierta' && 'font-medium text-success',
            s.status === 'cerrada' && (diff === 0 ? 'text-muted-foreground' : 'text-warning'),
          )}
        >
          {s.status === 'abierta'
            ? 'Abierta'
            : diff === 0
              ? 'Cuadró'
              : `${diff > 0 ? 'Sobró' : 'Faltó'} ${formatCop(Math.abs(diff))}`}
        </span>
      </div>
    </>
  )
  return (
    <li>
      {s.closing ? (
        <details>
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-raised">
            {head}
          </summary>
          <ClosedSessionDetail session={s} />
        </details>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">{head}</div>
      )}
    </li>
  )
}

/** Detalle de una caja cerrada: lo guarda el cierre, así no se vuelven a leer pagos ni cuentas. */
function ClosedSessionDetail({ session }: { session: CashSession }) {
  const c = session.closing
  if (!c) return null
  const s = c.summary
  const channels = CHANNELS.filter((ch) => (s.byChannel?.[ch] ?? 0) > 0)
  return (
    <div className="flex flex-col gap-3 px-4 pb-4 text-label">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Detail label="Ventas" value={formatCop(s.sales)} />
        <Detail label="Cuentas pagadas" value={String(s.ordersPaid)} />
        <Detail label="Saldo inicial" value={formatCop(session.openingBalance)} />
        <Detail label="Efectivo cobrado" value={formatCop(s.cash)} />
        <Detail label="Transferencias" value={formatCop(s.transfer)} />
        <Detail label="Entradas" value={formatCop(s.movementsIn)} />
        <Detail label="Salidas" value={formatCop(s.movementsOut)} />
        <Detail label="Efectivo esperado" value={formatCop(c.expectedCash)} />
        <Detail label="Efectivo contado" value={formatCop(c.countedCash)} />
        <Detail label="Diferencia" value={formatCop(c.difference)} />
      </dl>
      {channels.length > 0 && (
        <p className="text-muted-foreground">
          {channels.map((ch) => `${CHANNEL_LABELS[ch]} ${formatCop(s.byChannel[ch])}`).join(', ')}
        </p>
      )}
      {c.differenceReason && (
        <p className="text-muted-foreground">Motivo de la diferencia: {c.differenceReason}</p>
      )}
      <DaySummaryButton businessDate={session.businessDate} />
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="tabular font-medium">{value}</dd>
    </div>
  )
}

function OpenSessionPanel({ session }: { session: CashSession }) {
  const payments = usePaymentsOfSession(session.id)
  const movements = useCashMovements(session.id)
  const [moving, setMoving] = useState(false)
  const [closing, setClosing] = useState(false)
  const [correcting, setCorrecting] = useState<Payment | null>(null)
  const totals = sessionTotals(payments.data ?? [], movements.data ?? [])
  const cashNow = expectedCash(session.openingBalance, totals)
  const transfers = CHANNELS.filter((c) => totals.byChannel[c] > 0)
  const recentPayments = [...(payments.data ?? [])].reverse()

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-5 rounded-xl border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-lg bg-success/12 text-success">
              <Wallet aria-hidden className="size-5" />
            </span>
            <div>
              <p className="text-title font-semibold">Caja #{session.number} abierta</p>
              <p className="text-label text-muted-foreground first-letter:uppercase">
                Jornada del {formatBusinessDateLong(session.businessDate)}
                {session.openedAt && `, desde las ${formatTime(session.openedAt)}`}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setMoving(true)}>
              <ArrowDownUp aria-hidden />
              Entrada o salida
            </Button>
            <Button onClick={() => setClosing(true)}>
              <LockKeyhole aria-hidden />
              Cerrar caja
            </Button>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Saldo inicial" value={formatCop(session.openingBalance)} />
          <Stat label="Cobrado en efectivo" value={formatCop(totals.cash)} />
          <Stat label="Transferencias" value={formatCop(totals.transfer)} />
          <Stat label="Pagos" value={String(totals.paymentsCount)} />
        </dl>
        {(transfers.length > 0 || totals.movementsIn > 0 || totals.movementsOut > 0) && (
          <p className="flex flex-wrap gap-x-5 gap-y-1 text-label text-muted-foreground">
            {transfers.map((c) => (
              <span key={c}>
                {CHANNEL_LABELS[c]}{' '}
                <span className="tabular text-foreground">{formatCop(totals.byChannel[c])}</span>
              </span>
            ))}
            {totals.movementsIn > 0 && (
              <span>
                Entradas{' '}
                <span className="tabular text-foreground">{formatCop(totals.movementsIn)}</span>
              </span>
            )}
            {totals.movementsOut > 0 && (
              <span>
                Salidas{' '}
                <span className="tabular text-foreground">{formatCop(totals.movementsOut)}</span>
              </span>
            )}
          </p>
        )}
      </section>

      <section aria-labelledby="pagos-caja" className="flex flex-col gap-3">
        <h2 id="pagos-caja" className="text-title font-semibold">
          Pagos de esta caja
        </h2>
        {payments.error ? (
          <p role="alert" className="text-label text-destructive">
            No se pudieron cargar los pagos: {payments.error.message}
          </p>
        ) : recentPayments.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-4 text-label text-muted-foreground">
            Aún no hay pagos. Se cobran desde cada cuenta.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border bg-card">
            {recentPayments.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {methodLabel(p)}
                    {p.correctedFrom && (
                      <span className="ml-2 text-meta font-normal text-warning">
                        corregido, antes {methodLabel(p.correctedFrom)}
                      </span>
                    )}
                  </p>
                  <p className="text-meta text-subtle-foreground">
                    {p.createdAt ? formatTime(p.createdAt) : 'Ahora'}
                    {p.change > 0 && `, cambio ${formatCop(p.change)}`}
                    {p.reference && `, ref. ${p.reference}`}
                    {', '}
                    <Link
                      to={`/cuentas/${p.orderId}`}
                      className="text-primary-text hover:underline"
                    >
                      ver cuenta
                    </Link>
                  </p>
                </div>
                <span className="tabular font-semibold">{formatCop(p.amount)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Corregir medio del pago de ${formatCop(p.amount)}`}
                  title="Corregir medio de pago"
                  onClick={() => setCorrecting(p)}
                  className="text-muted-foreground"
                >
                  <Pencil aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(movements.data ?? []).length > 0 && (
        <section aria-labelledby="movimientos-caja" className="flex flex-col gap-3">
          <h2 id="movimientos-caja" className="text-title font-semibold">
            Entradas y salidas
          </h2>
          <ul className="divide-y divide-border rounded-xl border bg-card">
            {(movements.data ?? []).map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{CASH_MOVEMENT_LABELS[m.type]}</p>
                  <p className="text-meta text-subtle-foreground">
                    {m.createdAt ? formatTime(m.createdAt) : 'Ahora'}, {m.reason}
                  </p>
                </div>
                <span className={cn('tabular font-semibold', m.amount < 0 && 'text-destructive')}>
                  {m.amount > 0 ? '+' : '−'}
                  {formatCop(Math.abs(m.amount))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <CashMovementDialog
        session={session}
        cashAvailable={cashNow}
        open={moving}
        onOpenChange={setMoving}
      />
      <CloseCashDialog session={session} open={closing} onOpenChange={setClosing} />
      <CorrectPaymentDialog payment={correcting} onOpenChange={(o) => !o && setCorrecting(null)} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className="tabular text-figure font-semibold">{value}</dd>
    </div>
  )
}

function OpenCashForm() {
  const { user } = useAuth()
  // ID de la caja generado al mostrar el formulario (D-203): repetir no abre dos cajas.
  const [sessionId] = useState(() => crypto.randomUUID())
  const [balance, setBalance] = useState<number | null>(null)
  const [pending, setPending] = useState(false)
  const [touched, setTouched] = useState(false)
  const error = validateOpeningBalance(balance)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (error || balance === null) return
    setPending(true)
    try {
      await openCashSession(user?.uid ?? '', sessionId, balance)
      toast.success('Caja abierta. Ya puedes vender.')
    } catch (err) {
      toast.error(
        err instanceof CashError ? err.message : `No se pudo abrir: ${(err as Error).message}`,
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-5 rounded-xl border bg-card p-5 sm:max-w-md sm:p-6"
    >
      <div>
        <p className="text-title font-semibold">Abrir caja</p>
        <p className="mt-1 text-label text-muted-foreground">
          Cuenta el efectivo con el que empiezas la jornada (la base para dar cambio).
        </p>
      </div>
      <FormField
        id="opening"
        label="Saldo inicial en efectivo"
        error={touched ? (error ?? undefined) : undefined}
      >
        <MoneyInput
          id="opening"
          value={balance}
          onChange={setBalance}
          autoFocus
          aria-invalid={touched && !!error}
        />
      </FormField>
      <Button type="submit" size="lg" disabled={pending}>
        {pending && <Loader2 aria-hidden className="animate-spin" />}
        Abrir caja
      </Button>
    </form>
  )
}
