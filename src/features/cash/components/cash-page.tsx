import { useState } from 'react'
import { Loader2, LockKeyhole, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { MoneyInput } from '@/components/shared/inputs'
import { Page, PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { formatBusinessDateLong, formatDateTime } from '@/domain/dates'
import { formatCop } from '@/domain/money'
import { FormField } from '@/features/auth/components/form-field'
import { useAuth } from '@/features/auth/use-auth'
import { CashError, validateOpeningBalance, type CashSession } from '../domain/cash'
import {
  openCashSession,
  useOpenCashSession,
  useRecentCashSessions,
} from '../services/cash-service'

/** Caja: apertura (Fase 4, D-217). El arqueo y el cierre llegan en la Fase 5. */
export function CashPage() {
  const open = useOpenCashSession()
  const recent = useRecentCashSessions()

  return (
    <Page>
      <PageHeader
        title="Caja"
        description="Sin caja abierta no se pueden abrir cuentas ni vender."
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
            Cajas recientes
          </h2>
          <ul className="divide-y divide-border rounded-xl border bg-card">
            {recent.data.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <p className="font-medium">Caja #{s.number}</p>
                  <p className="text-meta text-subtle-foreground first-letter:uppercase">
                    {formatBusinessDateLong(s.businessDate)}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="tabular text-label text-muted-foreground">
                    Inicial {formatCop(s.openingBalance)}
                  </span>
                  <span
                    className={
                      s.status === 'abierta'
                        ? 'text-label font-medium text-success'
                        : 'text-label text-muted-foreground'
                    }
                  >
                    {s.status === 'abierta' ? 'Abierta' : 'Cerrada'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Page>
  )
}

function OpenSessionPanel({ session }: { session: CashSession }) {
  return (
    <section className="flex flex-col gap-5 rounded-xl border bg-card p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-lg bg-success/12 text-success">
          <Wallet aria-hidden className="size-5" />
        </span>
        <div>
          <p className="text-title font-semibold">Caja #{session.number} abierta</p>
          <p className="text-label text-muted-foreground first-letter:uppercase">
            Jornada del {formatBusinessDateLong(session.businessDate)}
          </p>
        </div>
      </div>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-label text-muted-foreground">Saldo inicial</dt>
          <dd className="tabular text-figure font-semibold">{formatCop(session.openingBalance)}</dd>
        </div>
        <div>
          <dt className="text-label text-muted-foreground">Abierta desde</dt>
          <dd className="tabular text-base font-medium">
            {session.openedAt ? formatDateTime(session.openedAt) : '—'}
          </dd>
        </div>
      </dl>
      <p className="flex items-start gap-2 rounded-lg bg-raised px-4 py-3 text-label text-muted-foreground">
        <LockKeyhole aria-hidden className="mt-0.5 size-4 shrink-0" />
        Los cobros, el arqueo y el cierre de caja llegan en la Fase 5.
      </p>
    </section>
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
