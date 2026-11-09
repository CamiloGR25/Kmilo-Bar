import { useState } from 'react'
import { Loader2 } from 'lucide-react'
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
import { businessDateOf } from '@/domain/dates'
import { formatCop } from '@/domain/money'
import { useAuth } from '@/features/auth/use-auth'
import { useCashNow } from '@/features/cash/hooks/use-cash-now'
import { CAPITAL_LABELS, type CapitalType } from '../domain/finance'
import { newId, registerCapital } from '../services/finance-service'
import { choiceClass } from './choice'

const HINTS: Record<CapitalType, string> = {
  inversion_inicial:
    'Cada cosa en la que invertiste antes de abrir: adecuación, neveras, mesas, sonido, inventario inicial, permisos…',
  aporte: 'Plata que pones al negocio después de abrir (por ejemplo, para cubrir un mes flojo).',
  retiro: 'Ganancias que sacas para ti. No es gasto ni baja la utilidad.',
}

export function CapitalDialog({
  open,
  onOpenChange,
  type,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: CapitalType
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && <CapitalForm type={type} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

/** Inversión inicial, aporte o retiro (F8-04, R-FIN-02). Con `cashOnly` va forzado a la caja. */
export function CapitalForm({
  type,
  onDone,
  cashOnly,
  embedded,
}: {
  type: CapitalType
  onDone: () => void
  cashOnly?: boolean
  embedded?: boolean
}) {
  const { user } = useAuth()
  const { session, cashNow } = useCashNow()
  const [entryId] = useState(newId)
  const [today] = useState(() => businessDateOf(new Date()))
  const [amount, setAmount] = useState<number | null>(null)
  const [date, setDate] = useState(today)
  const [description, setDescription] = useState('')
  const [fromCash, setFromCash] = useState(Boolean(cashOnly))
  const [pending, setPending] = useState(false)
  const canUseCash = type !== 'inversion_inicial'
  const overCash = type === 'retiro' && canUseCash && fromCash && (amount ?? 0) > cashNow

  async function submit() {
    setPending(true)
    try {
      await registerCapital(user?.uid ?? '', entryId, {
        type,
        amount,
        businessDate: date,
        description,
        fromCash: canUseCash && fromCash,
      })
      toast.success(`${CAPITAL_LABELS[type]} registrado: ${formatCop(amount ?? 0)}`)
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!embedded && (
        <DialogHeader>
          <DialogTitle className="text-title">{CAPITAL_LABELS[type]}</DialogTitle>
          <DialogDescription className="text-label">{HINTS[type]}</DialogDescription>
        </DialogHeader>
      )}
      {embedded && <p className="text-label text-muted-foreground">{HINTS[type]}</p>}
      <div className="flex flex-col gap-2">
        <Label htmlFor="cap-amount">Monto</Label>
        <MoneyInput id="cap-amount" value={amount} onChange={setAmount} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="cap-desc">
          {type === 'inversion_inicial' ? 'En qué se invirtió' : 'Descripción (opcional)'}
        </Label>
        <Input
          id="cap-desc"
          maxLength={200}
          placeholder={type === 'inversion_inicial' ? 'Nevera vertical' : ''}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      {canUseCash && !cashOnly && (
        <div className="flex flex-col gap-2">
          <div role="group" aria-label="Pasa por la caja" className="flex gap-2">
            <button
              type="button"
              className={choiceClass(fromCash)}
              aria-pressed={fromCash}
              onClick={() => setFromCash(true)}
            >
              {type === 'aporte' ? 'Entra a la caja' : 'Sale de la caja'}
            </button>
            <button
              type="button"
              className={choiceClass(!fromCash)}
              aria-pressed={!fromCash}
              onClick={() => setFromCash(false)}
            >
              Por fuera
            </button>
          </div>
          {fromCash && !session && (
            <p className="text-meta text-destructive">No hay caja abierta.</p>
          )}
        </div>
      )}
      {!(canUseCash && fromCash) && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="cap-date">Fecha</Label>
          <Input
            id="cap-date"
            type="date"
            max={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      )}
      <DialogFooter>
        {overCash && session && (
          <p className="mr-auto text-label text-destructive">
            En la caja hay {formatCop(cashNow)}.
          </p>
        )}
        <Button
          disabled={pending || (canUseCash && fromCash && !session) || overCash}
          onClick={submit}
        >
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          Registrar
        </Button>
      </DialogFooter>
    </div>
  )
}
