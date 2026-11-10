import { useState } from 'react'
import { Banknote, Loader2, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { MoneyInput } from '@/components/shared/inputs'
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
import { formatCop } from '@/domain/money'
import { useAuth } from '@/features/auth/use-auth'
import { billedRounds, orderTitle, roundPending, type Order } from '@/features/orders/domain/orders'
import { cn } from '@/lib/utils'
import {
  allocatePlan,
  cashSuggestions,
  CHANNEL_LABELS,
  CHANNELS,
  PaymentError,
  planCashPayment,
  planTransferPayment,
  type PaymentMethod,
  type PaymentPlan,
  type TransferChannel,
} from '../domain/payments'
import { registerAllocatedPayments, registerPayment } from '../services/payments-service'

/**
 * Cobro (R-PAG-01/02, D-230). Con `roundId`, cobra esa ronda. Con `roundId` nulo, cobra todo lo
 * pendiente repartido en orden de ronda (cada parte queda ligada a su ronda). La cuenta sigue
 * abierta: no se cierra al cobrar.
 */
export function PaymentDialog({
  order,
  roundId,
  open,
  onOpenChange,
  onCancelRound,
}: {
  order: Order
  roundId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Solo en el cobro de una ronda sin pagos: la cancela (los productos vuelven al stock). */
  onCancelRound?: (roundId: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* key: un formulario (y un ID de pago) nuevo por cada pago (D-203) */}
        {open && (
          <PaymentForm
            key={`${order.id}-${roundId ?? 'todas'}-${order.paidTotal}`}
            order={order}
            roundId={roundId}
            onDone={() => onOpenChange(false)}
            onCancelRound={onCancelRound}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function plan(
  balance: number,
  method: PaymentMethod,
  cash: number | null,
  amount: number | null,
  channel: TransferChannel | null,
  reference: string,
): { plan: PaymentPlan | null; error: string | null } {
  try {
    return {
      plan:
        method === 'efectivo'
          ? planCashPayment(balance, cash)
          : planTransferPayment(balance, amount, channel, reference),
      error: null,
    }
  } catch (e) {
    return { plan: null, error: e instanceof PaymentError ? e.message : String(e) }
  }
}

function PaymentForm({
  order,
  roundId,
  onDone,
  onCancelRound,
}: {
  order: Order
  roundId: string | null
  onDone: () => void
  onCancelRound?: (roundId: string) => void
}) {
  const { user } = useAuth()
  const [paymentId] = useState(() => crypto.randomUUID())
  const rounds = billedRounds(order)
  const round = roundId ? rounds.find((r) => r.id === roundId) : undefined
  // Lo que se cobra: la ronda elegida o todo lo pendiente de la cuenta.
  const balance = roundId ? roundPending(order, roundId) : order.balance
  const [method, setMethod] = useState<PaymentMethod>('efectivo')
  const [cash, setCash] = useState<number | null>(null)
  // El monto de transferencia sigue al saldo hasta que la persona lo escribe: así no queda en 0
  // si el saldo llega después de abrir el cobro.
  const [amountTyped, setAmountTyped] = useState<number | null | undefined>(undefined)
  const amount = amountTyped === undefined ? balance : amountTyped
  const [channel, setChannel] = useState<TransferChannel | null>(null)
  const [reference, setReference] = useState('')
  const [pending, setPending] = useState(false)
  const [touched, setTouched] = useState(false)

  const result = plan(balance, method, cash, amount, channel, reference)
  const p = result.plan
  const cancellable = !!round && round.paid === 0 && round.total > 0 && !!onCancelRound

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!p) return
    setPending(true)
    try {
      if (roundId) {
        await registerPayment(user?.uid ?? '', order.id, paymentId, p, roundId)
        const left = balance - p.amount
        toast.success(
          left > 0
            ? `Pago registrado. La ronda aún debe ${formatCop(left)}`
            : `Ronda ${round?.number ?? ''} cobrada`,
        )
      } else {
        // Cobro de todo: se reparte en orden de ronda; cada parte se registra en su ronda.
        const parts = allocatePlan(
          p,
          rounds.filter((r) => r.pending > 0).map((r) => ({ id: r.id, pending: r.pending })),
        )
        await registerAllocatedPayments(user?.uid ?? '', order.id, paymentId, parts)
        toast.success(
          p.amount >= balance
            ? 'Todas las rondas quedaron cobradas'
            : `Cobro registrado. Falta ${formatCop(balance - p.amount)}`,
        )
      }
      onDone()
    } catch (err) {
      toast.error(
        err instanceof PaymentError ? err.message : `No se pudo cobrar: ${(err as Error).message}`,
      )
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle className="text-title">
          {roundId
            ? `Cobrar ronda ${round?.number ?? ''} · ${orderTitle(order)}`
            : `Cobrar todo lo pendiente · ${orderTitle(order)}`}
        </DialogTitle>
        <DialogDescription className="text-label">
          Cuenta #{order.number}.{' '}
          {roundId
            ? 'Puedes cobrar todo o una parte (pago mixto o dividido); la cuenta sigue abierta.'
            : 'Se reparte en las rondas pendientes en orden; cada ronda queda con su cobro.'}
        </DialogDescription>
      </DialogHeader>

      <div className="flex items-baseline justify-between rounded-lg bg-raised px-4 py-3">
        <span className="text-label text-muted-foreground">
          {roundId ? 'Por cobrar de esta ronda' : 'Por cobrar en la cuenta'}
        </span>
        <span className="tabular text-display leading-none font-semibold">
          {formatCop(balance)}
        </span>
      </div>

      <div role="radiogroup" aria-label="Medio de pago" className="grid grid-cols-2 gap-2">
        {(
          [
            ['efectivo', 'Efectivo', Banknote],
            ['transferencia', 'Transferencia', Smartphone],
          ] as const
        ).map(([m, label, Icon]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={method === m}
            onClick={() => {
              setMethod(m)
              setTouched(false)
            }}
            className={cn(
              'flex h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border font-medium transition-colors',
              method === m
                ? 'border-primary bg-primary/12 text-foreground'
                : 'text-muted-foreground hover:bg-raised',
            )}
          >
            <Icon aria-hidden className="size-5" />
            {label}
          </button>
        ))}
      </div>

      {method === 'efectivo' ? (
        <div className="flex flex-col gap-3">
          <Label htmlFor="pay-cash">Recibido en efectivo</Label>
          <div className="flex flex-wrap gap-2">
            {cashSuggestions(balance).map((v) => (
              <Button
                key={v}
                type="button"
                variant={cash === v ? 'default' : 'outline'}
                className="tabular"
                onClick={() => setCash(v)}
              >
                {v === balance ? 'Exacto' : formatCop(v)}
              </Button>
            ))}
          </div>
          <MoneyInput id="pay-cash" value={cash} onChange={setCash} autoFocus />
          {p && (
            <dl className="grid grid-cols-2 gap-2 text-label">
              <div className="rounded-lg border px-3 py-2">
                <dt className="text-muted-foreground">Abona</dt>
                <dd className="tabular font-semibold">{formatCop(p.amount)}</dd>
              </div>
              <div
                className={cn(
                  'rounded-lg border px-3 py-2',
                  p.change > 0 && 'border-success/50 bg-success/8',
                )}
              >
                <dt className="text-muted-foreground">Cambio</dt>
                <dd className="tabular text-title font-semibold">{formatCop(p.change)}</dd>
              </div>
            </dl>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-label font-medium">¿Por dónde llegó?</legend>
            <div className="flex flex-wrap gap-2">
              {CHANNELS.map((c) => (
                <Button
                  key={c}
                  type="button"
                  variant={channel === c ? 'default' : 'outline'}
                  aria-pressed={channel === c}
                  onClick={() => setChannel(c)}
                >
                  {CHANNEL_LABELS[c]}
                </Button>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pay-amount">Monto</Label>
            <MoneyInput id="pay-amount" value={amount} onChange={(v) => setAmountTyped(v)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pay-ref">
              Referencia <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id="pay-ref"
              value={reference}
              maxLength={60}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Ej. M12345"
            />
          </div>
        </div>
      )}

      {p && p.balanceAfter > 0 && (
        <p className="text-label text-warning">
          Pago parcial: quedará un saldo de {formatCop(p.balanceAfter)}.
        </p>
      )}
      {touched && result.error && (
        <p role="alert" className="text-label text-destructive">
          {result.error}
        </p>
      )}

      <DialogFooter className="flex-wrap sm:justify-between">
        {cancellable && round && (
          <Button
            type="button"
            variant="destructive"
            onClick={() => onCancelRound?.(round.id)}
            disabled={pending}
          >
            Cancelar ronda
          </Button>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => onDone()} disabled={pending}>
            Dejar pendiente
          </Button>
          <Button type="submit" disabled={pending || (touched && !p)}>
            {pending && <Loader2 aria-hidden className="animate-spin" />}
            {p ? `Registrar ${formatCop(p.amount)}` : 'Registrar pago'}
          </Button>
        </div>
      </DialogFooter>
    </form>
  )
}
