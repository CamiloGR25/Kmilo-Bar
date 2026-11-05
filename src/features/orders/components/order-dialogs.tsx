import { useState } from 'react'
import { Loader2, Minus, Plus } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { formatCop } from '@/domain/money'
import { useAuth } from '@/features/auth/use-auth'
import { isFree, type Table } from '@/features/tables/domain/tables'
import { cn } from '@/lib/utils'
import {
  OrderError,
  orderTitle,
  type CancelMode,
  type LineGroup,
  type Order,
} from '../domain/orders'
import { cancelGroup, moveOrder, newId, setOrderLabel } from '../services/orders-service'

const errorText = (e: unknown) =>
  e instanceof OrderError ? e.message : `No se pudo guardar: ${(e as Error).message}`

// ---------------------------------------------------------------------------
// Cancelar ítem (R-VEN-05, D-217)
// ---------------------------------------------------------------------------

const MODES: { mode: CancelMode; title: string; detail: string }[] = [
  {
    mode: 'devolver',
    title: 'No se sirvió',
    detail: 'El producto vuelve al inventario.',
  },
  {
    mode: 'perdida',
    title: 'Se sirvió y no se cobra',
    detail: 'No vuelve al inventario: cuenta como pérdida a costo.',
  },
]

/** Cancelar unidades de un renglón de la cuenta (todas las rondas de ese producto, D-218). */
export function CancelLineDialog({
  order,
  group,
  onOpenChange,
}: {
  order: Order
  group: LineGroup | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={!!group} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* key: un formulario (y un opId) nuevo cada vez que se abre */}
        {group && (
          <CancelForm
            key={`${group.key}-${group.activeQty}`}
            order={order}
            group={group}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CancelForm({
  order,
  group,
  onDone,
}: {
  order: Order
  group: LineGroup
  onDone: () => void
}) {
  const { user } = useAuth()
  const [opId] = useState(newId)
  const line = group // nombre y precio del renglón
  const max = group.activeQty
  const [qty, setQty] = useState(1)
  const [mode, setMode] = useState<CancelMode>('devolver')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const canSubmit = reason.trim().length >= 3 && qty >= 1 && qty <= max && !pending

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setPending(true)
    try {
      await cancelGroup(user?.uid ?? '', { orderId: order.id, group, opId, qty, mode, reason })
      toast.success(
        mode === 'devolver'
          ? `${qty} × ${line.nameSnap} cancelado y devuelto al inventario`
          : `${qty} × ${line.nameSnap} registrado como pérdida`,
      )
      onDone()
    } catch (err) {
      toast.error(errorText(err))
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle className="text-title">Cancelar {line.nameSnap}</DialogTitle>
        <DialogDescription className="text-label">
          {orderTitle(order)}. Hay {max} {max === 1 ? 'activa' : 'activas'} en la cuenta, a{' '}
          {formatCop(line.unitPrice)} cada una.
        </DialogDescription>
      </DialogHeader>

      {max > 1 && (
        <div className="flex flex-col gap-2">
          <Label>Cantidad a cancelar</Label>
          <Stepper value={qty} min={1} max={max} onChange={setQty} label={line.nameSnap} />
        </div>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-label font-medium">¿Qué pasó?</legend>
        {MODES.map((m) => (
          <label
            key={m.mode}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors',
              mode === m.mode ? 'border-primary bg-primary/8' : 'hover:bg-raised',
            )}
          >
            <input
              type="radio"
              name="cancel-mode"
              value={m.mode}
              checked={mode === m.mode}
              onChange={() => setMode(m.mode)}
              className="mt-1 size-4 accent-[var(--primary)]"
            />
            <span>
              <span className="block font-medium">{m.title}</span>
              <span className="block text-label text-muted-foreground">{m.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor="cancel-reason">Motivo</Label>
        <Textarea
          id="cancel-reason"
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
          placeholder={mode === 'devolver' ? 'Ej. Pidió otra marca' : 'Ej. Se fue sin pagar'}
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Volver
        </Button>
        <Button type="submit" variant="destructive" disabled={!canSubmit}>
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          Cancelar {qty} {qty === 1 ? 'unidad' : 'unidades'}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  label: string
}) {
  return (
    <div className="inline-flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={`Quitar una unidad de ${label}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Minus aria-hidden />
      </Button>
      <span className="w-10 text-center tabular text-base font-semibold" aria-live="polite">
        {value}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={`Agregar una unidad de ${label}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus aria-hidden />
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mover de mesa (R-VEN-06, D-217)
// ---------------------------------------------------------------------------

export function MoveOrderDialog({
  order,
  tables,
  open,
  onOpenChange,
}: {
  order: Order
  tables: Table[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { user } = useAuth()
  const [pending, setPending] = useState<string | null>(null)
  const free = tables.filter((t) => isFree(t) && t.id !== order.tableId)

  async function move(t: Table) {
    setPending(t.id)
    try {
      await moveOrder(user?.uid ?? '', order.id, t.id)
      toast.success(`Cuenta movida a ${t.name}`)
      onOpenChange(false)
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setPending(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-title">
            {order.type === 'barra' ? 'Pasar la cuenta a una mesa' : 'Mover a otra mesa'}
          </DialogTitle>
          <DialogDescription className="text-label">
            {orderTitle(order)}, cuenta #{order.number}. Solo aparecen las mesas libres.
          </DialogDescription>
        </DialogHeader>
        {free.length === 0 ? (
          <p className="rounded-lg bg-raised px-4 py-3 text-label text-muted-foreground">
            No hay mesas libres en este momento.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {free.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => move(t)}
                  className="flex h-20 w-full cursor-pointer flex-col items-start justify-between rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:border-border-strong hover:bg-raised disabled:opacity-50"
                >
                  <span className="text-meta text-muted-foreground">{t.name}</span>
                  <span className="inline-flex items-center gap-2 tabular text-figure leading-none font-semibold">
                    {t.number}
                    {pending === t.id && <Loader2 aria-hidden className="size-4 animate-spin" />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Nombre de la cuenta de barra
// ---------------------------------------------------------------------------

export function LabelDialog({
  order,
  open,
  onOpenChange,
}: {
  order: Order
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [label, setLabel] = useState(order.label ?? '')
  const [pending, setPending] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    try {
      await setOrderLabel(order.id, label)
      toast.success('Nombre guardado')
      onOpenChange(false)
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle className="text-title">Nombre de la cuenta</DialogTitle>
            <DialogDescription className="text-label">
              Sirve para distinguir las cuentas de barra. Déjalo vacío para usar el número.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Nombre de la cuenta"
            value={label}
            maxLength={40}
            autoFocus
            onChange={(e) => setLabel(e.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Volver
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 aria-hidden className="animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
