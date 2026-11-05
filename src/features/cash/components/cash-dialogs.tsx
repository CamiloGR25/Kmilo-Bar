import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Link } from 'react-router'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatCop } from '@/domain/money'
import { useAuth } from '@/features/auth/use-auth'
import { cn } from '@/lib/utils'
import { CashError, type CashSession } from '../domain/cash'
import {
  CASH_MOVEMENT_LABELS,
  cashDifference,
  CHANNEL_LABELS,
  CHANNELS,
  MAX_COUNTED,
  methodLabel,
  PaymentError,
  planCashMovement,
  validateClosing,
  type CashMovementType,
  type Payment,
  type PaymentMethod,
  type TransferChannel,
} from '../domain/payments'
import { closeCashSession, loadClosingData, registerCashMovement } from '../services/cash-service'
import { correctPaymentMethod } from '../services/payments-service'

const errorText = (e: unknown) =>
  e instanceof PaymentError || e instanceof CashError
    ? e.message
    : `No se pudo guardar: ${(e as Error).message}`

// ---------------------------------------------------------------------------
// Entrada o salida de efectivo (R-PAG-05)
// ---------------------------------------------------------------------------

const MOVEMENT_OPTIONS: { type: CashMovementType; detail: string }[] = [
  { type: 'entrada_extra', detail: 'Entra efectivo que no es venta (ej. más base para cambio).' },
  { type: 'retiro_dueno', detail: 'Sale efectivo de la caja para el dueño.' },
  { type: 'correccion', detail: 'Ajuste con motivo: suma o resta efectivo.' },
]

export function CashMovementDialog({
  session,
  cashAvailable,
  open,
  onOpenChange,
}: {
  session: CashSession
  /** Efectivo esperado en este momento (una salida no puede superarlo). */
  cashAvailable: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && (
          <MovementForm
            session={session}
            cashAvailable={cashAvailable}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function MovementForm({
  session,
  cashAvailable,
  onDone,
}: {
  session: CashSession
  cashAvailable: number
  onDone: () => void
}) {
  const { user } = useAuth()
  const [movementId] = useState(() => crypto.randomUUID())
  const [type, setType] = useState<CashMovementType>('entrada_extra')
  const [direction, setDirection] = useState<'entra' | 'sale'>('sale')
  const [amount, setAmount] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [touched, setTouched] = useState(false)

  let signed: number | null = null
  let error: string | null = null
  try {
    signed = planCashMovement(type, direction, amount, reason, cashAvailable)
  } catch (e) {
    error = (e as Error).message
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (signed === null) return
    setPending(true)
    try {
      await registerCashMovement(user?.uid ?? '', movementId, session, type, signed, reason)
      toast.success(`Movimiento registrado: ${CASH_MOVEMENT_LABELS[type].toLowerCase()}`)
      onDone()
    } catch (err) {
      toast.error(errorText(err))
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle className="text-title">Entrada o salida de efectivo</DialogTitle>
        <DialogDescription className="text-label">
          Queda registrada en la caja #{session.number} y cuenta en el arqueo.
        </DialogDescription>
      </DialogHeader>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-label font-medium">Tipo</legend>
        {MOVEMENT_OPTIONS.map((o) => (
          <label
            key={o.type}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors',
              type === o.type ? 'border-primary bg-primary/8' : 'hover:bg-raised',
            )}
          >
            <input
              type="radio"
              name="movement-type"
              checked={type === o.type}
              onChange={() => setType(o.type)}
              className="mt-1 size-4 accent-[var(--primary)]"
            />
            <span>
              <span className="block font-medium">{CASH_MOVEMENT_LABELS[o.type]}</span>
              <span className="block text-label text-muted-foreground">{o.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {type === 'correccion' && (
        <div role="radiogroup" aria-label="Dirección" className="grid grid-cols-2 gap-2">
          {(['entra', 'sale'] as const).map((d) => (
            <Button
              key={d}
              type="button"
              role="radio"
              aria-checked={direction === d}
              variant={direction === d ? 'default' : 'outline'}
              onClick={() => setDirection(d)}
            >
              {d === 'entra' ? 'Suma efectivo' : 'Resta efectivo'}
            </Button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="mov-amount">Monto</Label>
        <MoneyInput id="mov-amount" value={amount} onChange={setAmount} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="mov-reason">Motivo</Label>
        <Textarea
          id="mov-reason"
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      {touched && error && (
        <p role="alert" className="text-label text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Volver
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          Registrar
        </Button>
      </DialogFooter>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Corregir el medio de un pago (D-219)
// ---------------------------------------------------------------------------

export function CorrectPaymentDialog({
  payment,
  onOpenChange,
}: {
  payment: Payment | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={!!payment} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {payment && (
          <CorrectForm key={payment.id} payment={payment} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

type MethodChoice = { method: PaymentMethod; channel: TransferChannel | null }

function CorrectForm({ payment, onDone }: { payment: Payment; onDone: () => void }) {
  const { user } = useAuth()
  const [choice, setChoice] = useState<MethodChoice | null>(null)
  const [pending, setPending] = useState(false)
  const options: MethodChoice[] = [
    { method: 'efectivo' as const, channel: null },
    ...CHANNELS.map((c) => ({ method: 'transferencia' as const, channel: c })),
  ].filter((o) => !(o.method === payment.method && o.channel === payment.channel))

  async function submit() {
    if (!choice) return
    setPending(true)
    try {
      await correctPaymentMethod(user?.uid ?? '', payment.id, choice.method, choice.channel)
      toast.success(`Pago corregido a ${methodLabel(choice)}`)
      onDone()
    } catch (err) {
      toast.error(errorText(err))
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle className="text-title">Corregir medio de pago</DialogTitle>
        <DialogDescription className="text-label">
          Pago de {formatCop(payment.amount)} registrado como {methodLabel(payment)}. Solo cambia
          cómo entró el dinero; el monto y la cuenta no cambian.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const selected = choice?.method === o.method && choice.channel === o.channel
          return (
            <Button
              key={`${o.method}-${o.channel}`}
              type="button"
              variant={selected ? 'default' : 'outline'}
              aria-pressed={selected}
              onClick={() => setChoice(o)}
            >
              {o.method === 'efectivo' ? 'Efectivo' : CHANNEL_LABELS[o.channel ?? 'otro']}
            </Button>
          )
        })}
      </div>
      {payment.change > 0 && choice?.method === 'transferencia' && (
        <p className="text-label text-warning">
          Este pago tenía {formatCop(payment.change)} de cambio en efectivo. Al pasarlo a
          transferencia se asume que no hubo efectivo ni cambio.
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Volver
        </Button>
        <Button onClick={submit} disabled={!choice || pending}>
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          Corregir
        </Button>
      </DialogFooter>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Arqueo y cierre (R-PAG-06): primero se cuenta, después se compara
// ---------------------------------------------------------------------------

export function CloseCashDialog({
  session,
  open,
  onOpenChange,
}: {
  session: CashSession
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && <CloseForm session={session} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

type ClosingData = Awaited<ReturnType<typeof loadClosingData>>

function CloseForm({ session, onDone }: { session: CashSession; onDone: () => void }) {
  const { user } = useAuth()
  const [data, setData] = useState<ClosingData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [step, setStep] = useState<'count' | 'compare'>('count')
  const [counted, setCounted] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let alive = true
    loadClosingData(session)
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setLoadError(e.message))
    return () => {
      alive = false
    }
  }, [session])

  const header = (
    <DialogHeader>
      <DialogTitle className="text-title">Cerrar caja #{session.number}</DialogTitle>
      <DialogDescription className="text-label">
        {step === 'count'
          ? 'Cuenta todo el efectivo de la caja y escribe el total. Después verás cuánto debería haber.'
          : 'Revisa la diferencia. El cierre es definitivo.'}
      </DialogDescription>
    </DialogHeader>
  )

  if (loadError) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <p role="alert" className="text-label text-destructive">
          No se pudieron cargar los datos: {loadError}
        </p>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <div className="h-24 animate-pulse rounded-lg bg-raised" />
      </div>
    )
  }
  if (data.openOrders > 0) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <p className="rounded-lg border border-warning/40 bg-warning/8 px-4 py-3 text-label">
          {validateClosing(0, 0, '', data.openOrders)}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onDone}>
            Volver
          </Button>
          <Button asChild>
            <Link to="/mesas" onClick={onDone}>
              Ver mesas
            </Link>
          </Button>
        </DialogFooter>
      </div>
    )
  }

  const expected = data.expected
  const s = data.summary
  const difference = counted === null ? 0 : cashDifference(counted, expected)
  const error = validateClosing(counted, expected, reason, 0)

  async function close() {
    if (error || counted === null) return
    setPending(true)
    try {
      const res = await closeCashSession(user?.uid ?? '', session, counted, reason)
      toast.success(
        res.difference === 0
          ? `Caja #${session.number} cerrada. Cuadró exacto.`
          : `Caja #${session.number} cerrada: ${res.difference > 0 ? 'sobraron' : 'faltaron'} ${formatCop(Math.abs(res.difference))}.`,
      )
      onDone()
    } catch (err) {
      toast.error(errorText(err))
      setPending(false)
    }
  }

  if (step === 'count') {
    const tooHigh = counted !== null && counted > MAX_COUNTED
    return (
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (counted !== null && !tooHigh) setStep('compare')
        }}
      >
        {header}
        <div className="flex flex-col gap-2">
          <Label htmlFor="counted">Efectivo contado</Label>
          <MoneyInput
            id="counted"
            value={counted}
            onChange={setCounted}
            autoFocus
            aria-invalid={tooHigh}
          />
          {tooHigh && (
            <p role="alert" className="text-label text-destructive">
              El monto parece demasiado alto. Revisa la cifra.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Volver
          </Button>
          <Button type="submit" disabled={counted === null || tooHigh}>
            Continuar
          </Button>
        </DialogFooter>
      </form>
    )
  }

  const transfers = CHANNELS.filter((c) => s.byChannel[c] > 0)
  return (
    <div className="flex flex-col gap-5">
      {header}
      <dl className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border px-3 py-2">
          <dt className="text-meta text-muted-foreground">Esperado</dt>
          <dd className="tabular font-semibold">{formatCop(expected)}</dd>
        </div>
        <div className="rounded-lg border px-3 py-2">
          <dt className="text-meta text-muted-foreground">Contado</dt>
          <dd className="tabular font-semibold">{formatCop(counted ?? 0)}</dd>
        </div>
        <div
          className={cn(
            'rounded-lg border px-3 py-2',
            difference === 0
              ? 'border-success/50 bg-success/8'
              : 'border-destructive/50 bg-destructive-solid/8',
          )}
        >
          <dt className="text-meta text-muted-foreground">
            {difference === 0 ? 'Cuadra' : difference > 0 ? 'Sobra' : 'Falta'}
          </dt>
          <dd className="tabular font-semibold">{formatCop(Math.abs(difference))}</dd>
        </div>
      </dl>

      <div className="flex flex-col gap-1 rounded-lg bg-raised px-4 py-3 text-label">
        <Row label="Saldo inicial" value={session.openingBalance} />
        <Row label="Cobrado en efectivo" value={s.cash} sign="+" />
        {s.movementsIn > 0 && <Row label="Entradas" value={s.movementsIn} sign="+" />}
        {s.movementsOut > 0 && <Row label="Salidas" value={s.movementsOut} sign="−" />}
        <Row label="Efectivo esperado" value={expected} strong />
      </div>

      {transfers.length > 0 && (
        <div className="flex flex-col gap-1 text-label">
          <p className="font-medium">Transferencias para revisar en cada app</p>
          {transfers.map((c) => (
            <Row key={c} label={CHANNEL_LABELS[c]} value={s.byChannel[c]} />
          ))}
        </div>
      )}

      {difference !== 0 && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="diff-reason">Motivo de la diferencia</Label>
          <Textarea
            id="diff-reason"
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej. Se dio mal un cambio"
          />
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => setStep('count')} disabled={pending}>
          Volver a contar
        </Button>
        <Button onClick={close} disabled={!!error || pending}>
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          Cerrar caja
        </Button>
      </DialogFooter>
    </div>
  )
}

function Row({
  label,
  value,
  sign,
  strong,
}: {
  label: string
  value: number
  sign?: '+' | '−'
  strong?: boolean
}) {
  return (
    <p className={cn('flex justify-between gap-3', strong && 'border-t pt-1 font-semibold')}>
      <span className={strong ? undefined : 'text-muted-foreground'}>{label}</span>
      <span className="tabular">
        {sign && `${sign} `}
        {formatCop(value)}
      </span>
    </p>
  )
}
