import { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { IntegerInput, MoneyInput } from '@/components/shared/inputs'
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
import {
  CHANNEL_LABELS,
  CHANNELS,
  expectedCash,
  sessionTotals,
  type TransferChannel,
} from '@/features/cash/domain/payments'
import { useCashMovements, useOpenCashSession } from '@/features/cash/services/cash-service'
import { usePaymentsOfSession } from '@/features/cash/services/payments-service'
import type { Product } from '@/features/products/domain/catalog'
import { cn } from '@/lib/utils'
import {
  describeQty,
  orderBalance,
  pendingQty,
  planReception,
  purchaseUnitOf,
  validateSupplierPayment,
  type PurchaseOrder,
  type ReceptionLineInput,
  type SupplierPayMethod,
} from '../domain/purchases'
import { newId, receivePurchase, registerSupplierPayment } from '../services/purchases-service'

// ---------------------------------------------------------------------------
// Recibir mercancía (R-COM-02…04)
// ---------------------------------------------------------------------------

/**
 * Verificar lo que llegó: viene prellenado con lo pendiente y el costo pedido; se corrige solo lo
 * que no coincide. Llegar de más exige confirmarlo (R-COM-03).
 */
export function ReceiveDialog({
  order,
  products,
  open,
  onOpenChange,
  onReceived,
}: {
  order: PurchaseOrder
  products: Product[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onReceived: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {open && (
          <ReceiveForm
            order={order}
            products={products}
            onDone={(received) => {
              onOpenChange(false)
              if (received) onReceived()
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ReceiveForm({
  order,
  products,
  onDone,
}: {
  order: PurchaseOrder
  products: Product[]
  onDone: (received: boolean) => void
}) {
  const { user } = useAuth()
  const [opId] = useState(newId)
  const byId = new Map(products.map((p) => [p.id, p]))
  const lines = order.lines.filter((l) => pendingQty(l) > 0)
  const [input, setInput] = useState<ReceptionLineInput[]>(() =>
    lines.map((l) => ({ lineId: l.lineId, qty: pendingQty(l), unitCost: l.estUnitCost })),
  )
  const [notes, setNotes] = useState('')
  const [confirmOver, setConfirmOver] = useState(false)
  const [pending, setPending] = useState(false)

  let plan: ReturnType<typeof planReception> | null = null
  let error: string | null = null
  try {
    plan = planReception(order, input)
  } catch (e) {
    error = (e as Error).message
  }

  const set = (i: number, patch: Partial<ReceptionLineInput>) =>
    setInput((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  async function submit() {
    if (!plan) return
    if (plan.hasOver && !confirmOver) return
    setPending(true)
    try {
      await receivePurchase(user?.uid ?? '', order.id, opId, plan, notes)
      toast.success(`Recibido ${formatCop(plan.total)}: inventario actualizado`)
      onDone(true)
    } catch (e) {
      toast.error(`No se pudo recibir: ${(e as Error).message}`)
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-title">Recibir mercancía</DialogTitle>
        <DialogDescription className="text-label">
          Compara con lo que llegó y corrige lo que no coincide: cantidad (0 si no llegó) y costo
          real por unidad de la factura.
        </DialogDescription>
      </DialogHeader>
      <ul className="divide-y divide-border rounded-xl border">
        {lines.map((l, i) => {
          const x = input[i]!
          const unit = purchaseUnitOf(
            byId.get(l.productId) ?? { purchaseUnit: null, unitsPerPurchase: null },
          )
          const variance = x.unitCost !== null ? x.unitCost - l.estUnitCost : 0
          const over = (x.qty ?? 0) > pendingQty(l)
          return (
            <li key={l.lineId} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <p className="font-medium">{l.nameSnap}</p>
                <p className="text-meta text-subtle-foreground">
                  Pendiente: {describeQty(pendingQty(l), unit)}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-label text-muted-foreground">
                  Llegaron (unidades)
                  <IntegerInput
                    value={x.qty}
                    onChange={(qty) => set(i, { qty })}
                    aria-label={`Unidades que llegaron de ${l.nameSnap}`}
                    aria-invalid={over}
                  />
                </label>
                <label className="flex flex-col gap-1 text-label text-muted-foreground">
                  Costo real por unidad
                  <MoneyInput
                    value={x.unitCost}
                    onChange={(unitCost) => set(i, { unitCost })}
                    aria-label={`Costo real de ${l.nameSnap}`}
                  />
                </label>
              </div>
              <p className="text-meta">
                {unit && x.qty ? (
                  <span className="text-subtle-foreground">{describeQty(x.qty, unit)}. </span>
                ) : null}
                {variance !== 0 && (
                  <span className={variance > 0 ? 'text-destructive' : 'text-success'}>
                    {variance > 0 ? 'Más caro' : 'Más barato'} que lo pedido por{' '}
                    {formatCop(Math.abs(variance))} c/u.{' '}
                  </span>
                )}
                {over && <span className="text-warning">Llegó más de lo pendiente.</span>}
              </p>
            </li>
          )
        })}
      </ul>
      <div className="flex flex-col gap-2">
        <Label htmlFor="rec-notes">Notas (opcional)</Label>
        <Textarea
          id="rec-notes"
          maxLength={300}
          placeholder="Número de factura, novedades…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      {plan && (
        <div className="flex flex-col gap-1 rounded-lg bg-raised/60 px-4 py-3 text-label">
          <p className="flex justify-between gap-4 font-semibold">
            <span>Total recibido</span>
            <span className="tabular">{formatCop(plan.total)}</span>
          </p>
          {plan.variance !== 0 && (
            <p className="flex justify-between gap-4 text-muted-foreground">
              <span>Diferencia contra lo pedido (F-15)</span>
              <span
                className={cn('tabular', plan.variance > 0 ? 'text-destructive' : 'text-success')}
              >
                {plan.variance > 0 ? '+' : '−'}
                {formatCop(Math.abs(plan.variance))}
              </span>
            </p>
          )}
        </div>
      )}
      {plan?.hasOver && (
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-warning/50 bg-warning/8 px-4 py-3 text-label">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-[var(--warning)]"
            checked={confirmOver}
            onChange={(e) => setConfirmOver(e.target.checked)}
          />
          <span>
            <AlertTriangle aria-hidden className="mr-1 inline size-4 text-warning" />
            Confirmo que llegó más de lo pedido y lo recibo (queda registrado).
          </span>
        </label>
      )}
      {error && <p className="text-label text-destructive">{error}</p>}
      <DialogFooter>
        <Button disabled={!plan || pending || (plan.hasOver && !confirmOver)} onClick={submit}>
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          Confirmar y subir inventario
        </Button>
      </DialogFooter>
    </>
  )
}

// ---------------------------------------------------------------------------
// Pago al proveedor (R-COM-05, D-223 #3/#4)
// ---------------------------------------------------------------------------

export function SupplierPaymentDialog({
  order,
  open,
  onOpenChange,
  afterReception,
  fromCashDefault,
}: {
  order: PurchaseOrder
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Se abre justo después de recibir: "pagado ahora" o "queda debiendo". */
  afterReception?: boolean
  /** Desde la salida de caja (D-226 #4): empieza en efectivo "De la caja". */
  fromCashDefault?: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && (
          <PaymentForm
            order={order}
            afterReception={afterReception}
            fromCashDefault={fromCashDefault}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function PaymentForm({
  order,
  afterReception,
  fromCashDefault,
  onDone,
}: {
  order: PurchaseOrder
  afterReception?: boolean
  fromCashDefault?: boolean
  onDone: () => void
}) {
  const { user } = useAuth()
  const session = useOpenCashSession().data ?? null
  const cashPayments = usePaymentsOfSession(session?.id)
  const cashMoves = useCashMovements(session?.id)
  const cashNow = session
    ? expectedCash(
        session.openingBalance,
        sessionTotals(cashPayments.data ?? [], cashMoves.data ?? []),
      )
    : 0
  const balance = orderBalance(order)
  const [paymentId] = useState(newId)
  const [amount, setAmount] = useState<number | null>(balance)
  const [method, setMethod] = useState<SupplierPayMethod>('efectivo')
  const [channel, setChannel] = useState<TransferChannel>('nequi')
  const [source, setSource] = useState<'caja' | 'fuera'>(fromCashDefault ? 'caja' : 'fuera')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)

  const fromCash = method === 'efectivo' && source === 'caja'
  const error =
    validateSupplierPayment(amount, balance) ??
    (fromCash && !session ? 'No hay caja abierta: elige "Por fuera" o abre la caja.' : null) ??
    (fromCash && (amount ?? 0) > cashNow ? `En la caja hay ${formatCop(cashNow)}.` : null)

  async function submit() {
    if (error || amount === null) return
    setPending(true)
    try {
      await registerSupplierPayment(user?.uid ?? '', order.id, paymentId, {
        amount,
        method,
        channel: method === 'transferencia' ? channel : null,
        fromCash,
        notes,
      })
      toast.success(`Pago de ${formatCop(amount)} registrado`)
      onDone()
    } catch (e) {
      toast.error(`No se pudo registrar: ${(e as Error).message}`)
    } finally {
      setPending(false)
    }
  }

  const choice = (active: boolean) =>
    cn(
      'h-11 flex-1 cursor-pointer rounded-lg border px-3 text-label font-medium',
      active
        ? 'border-primary bg-primary/15 text-foreground'
        : 'text-muted-foreground hover:bg-raised',
    )

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-title">
          {afterReception ? '¿Le pagaste al proveedor?' : 'Pagar al proveedor'}
        </DialogTitle>
        <DialogDescription className="text-label">
          {order.supplierName}: le debes {formatCop(balance)} de este pedido.
          {afterReception && ' Si le quedas debiendo, cierra esta ventana; puedes pagar después.'}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        <Label htmlFor="pay-amount">Monto</Label>
        <MoneyInput id="pay-amount" value={amount} onChange={setAmount} />
      </div>
      <div role="group" aria-label="Medio" className="flex gap-2">
        <button
          type="button"
          className={choice(method === 'efectivo')}
          aria-pressed={method === 'efectivo'}
          onClick={() => setMethod('efectivo')}
        >
          Efectivo
        </button>
        <button
          type="button"
          className={choice(method === 'transferencia')}
          aria-pressed={method === 'transferencia'}
          onClick={() => setMethod('transferencia')}
        >
          Transferencia
        </button>
      </div>
      {method === 'efectivo' ? (
        <div className="flex flex-col gap-2">
          <p className="text-label text-muted-foreground">¿De dónde sale la plata?</p>
          <div role="group" aria-label="Origen" className="flex gap-2">
            <button
              type="button"
              className={choice(source === 'caja')}
              aria-pressed={source === 'caja'}
              onClick={() => setSource('caja')}
            >
              De la caja
            </button>
            <button
              type="button"
              className={choice(source === 'fuera')}
              aria-pressed={source === 'fuera'}
              onClick={() => setSource('fuera')}
            >
              Por fuera
            </button>
          </div>
          <p className="text-meta text-subtle-foreground">
            {source === 'caja'
              ? session
                ? `Se descuenta del efectivo de la caja #${session.number} (hay ${formatCop(cashNow)}).`
                : 'No hay caja abierta.'
              : 'De tu bolsillo u otra plata: no toca la caja del bar.'}
          </p>
        </div>
      ) : (
        <div role="group" aria-label="Canal" className="flex flex-wrap gap-2">
          {CHANNELS.map((c) => (
            <button
              key={c}
              type="button"
              className={cn(choice(channel === c), 'flex-none')}
              aria-pressed={channel === c}
              onClick={() => setChannel(c)}
            >
              {CHANNEL_LABELS[c]}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="pay-notes">Notas (opcional)</Label>
        <Textarea
          id="pay-notes"
          maxLength={300}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      {error && amount !== null && <p className="text-label text-destructive">{error}</p>}
      <DialogFooter className="gap-2">
        {afterReception && (
          <Button variant="outline" onClick={onDone}>
            Queda debiendo
          </Button>
        )}
        <Button disabled={Boolean(error) || pending} onClick={submit}>
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          Registrar pago
        </Button>
      </DialogFooter>
    </>
  )
}
