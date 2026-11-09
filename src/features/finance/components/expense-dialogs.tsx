import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { MoneyInput, NativeSelect } from '@/components/shared/inputs'
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
import { Switch } from '@/components/ui/switch'
import { businessDateOf } from '@/domain/dates'
import { formatCop } from '@/domain/money'
import { useAuth } from '@/features/auth/use-auth'
import { useCashNow } from '@/features/cash/hooks/use-cash-now'
import { cn } from '@/lib/utils'
import { choiceClass } from './choice'
import {
  EXPENSE_KIND_LABELS,
  type ExpenseCategory,
  type ExpenseKind,
  type FixedExpense,
  type PayMethod,
} from '../domain/finance'
import {
  newId,
  registerExpense,
  saveExpenseCategory,
  saveFixedExpense,
  setExpenseCategoryActive,
  setFixedExpenseActive,
} from '../services/finance-service'

// ---------------------------------------------------------------------------
// Registrar un gasto (F8-01)
// ---------------------------------------------------------------------------

export interface ExpensePreset {
  categoryId?: string
  amount?: number
  description?: string
  fixedExpenseId?: string | null
  /** Abre ya con "De la caja" (desde la salida de caja). */
  fromCash?: boolean
  /** Solo categorías de este tipo (p. ej. inversión). */
  kinds?: ExpenseKind[]
}

export function ExpenseDialog({
  open,
  onOpenChange,
  categories,
  preset,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: ExpenseCategory[]
  preset?: ExpensePreset
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && (
          <ExpenseForm
            categories={categories}
            preset={preset ?? {}}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

export function ExpenseForm({
  categories,
  preset,
  onDone,
  embedded,
}: {
  categories: ExpenseCategory[]
  preset: ExpensePreset
  onDone: () => void
  /** Dentro de otro diálogo (salida de caja): sin encabezado propio. */
  embedded?: boolean
}) {
  const { user } = useAuth()
  const { session, cashNow } = useCashNow()
  const [expenseId] = useState(newId)
  const [today] = useState(() => businessDateOf(new Date()))
  const selectable = categories.filter(
    (c) => c.active && (!preset.kinds || preset.kinds.includes(c.kind)),
  )
  const [categoryId, setCategoryId] = useState(preset.categoryId ?? selectable[0]?.id ?? '')
  const [amount, setAmount] = useState<number | null>(preset.amount ?? null)
  const [date, setDate] = useState(today)
  const [description, setDescription] = useState(preset.description ?? '')
  const [method, setMethod] = useState<PayMethod>('efectivo')
  const [fromCash, setFromCash] = useState(preset.fromCash ?? false)
  const [pending, setPending] = useState(false)
  const category = categories.find((c) => c.id === categoryId)
  const cashOut = method === 'efectivo' && fromCash
  const overCash = cashOut && session !== null && (amount ?? 0) > cashNow

  async function submit() {
    if (!category) return toast.error('Escoge la categoría.')
    setPending(true)
    try {
      await registerExpense(user?.uid ?? '', expenseId, {
        category,
        amount,
        businessDate: date,
        description,
        method,
        fromCash: cashOut,
        fixedExpenseId: preset.fixedExpenseId ?? null,
      })
      toast.success(`Gasto registrado: ${formatCop(amount ?? 0)}`)
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
          <DialogTitle className="text-title">
            {preset.fixedExpenseId ? 'Pagar gasto fijo' : 'Nuevo gasto'}
          </DialogTitle>
          <DialogDescription className="text-label">
            Elige si el efectivo sale de la caja (se descuenta en el arqueo) o lo pagas por fuera.
          </DialogDescription>
        </DialogHeader>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="exp-cat">Categoría</Label>
        <NativeSelect
          id="exp-cat"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          {selectable.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({EXPENSE_KIND_LABELS[c.kind].toLowerCase()})
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="exp-amount">Monto</Label>
        <MoneyInput id="exp-amount" value={amount} onChange={setAmount} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="exp-desc">Descripción (opcional)</Label>
        <Input
          id="exp-desc"
          maxLength={200}
          placeholder="Recibo de luz de octubre, flete…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div role="group" aria-label="Medio" className="flex gap-2">
        {(['efectivo', 'transferencia'] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={choiceClass(method === m)}
            aria-pressed={method === m}
            onClick={() => setMethod(m)}
          >
            {m === 'efectivo' ? 'Efectivo' : 'Transferencia'}
          </button>
        ))}
      </div>
      {method === 'efectivo' && (
        <div className="flex flex-col gap-2">
          <div role="group" aria-label="Origen" className="flex gap-2">
            <button
              type="button"
              className={choiceClass(fromCash)}
              aria-pressed={fromCash}
              onClick={() => setFromCash(true)}
            >
              De la caja
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
          <p className="text-meta text-subtle-foreground">
            {fromCash
              ? session
                ? `Sale del efectivo de la caja #${session.number} (hay ${formatCop(cashNow)}).`
                : 'No hay caja abierta: escoge "Por fuera" o abre la caja.'
              : 'De tu bolsillo u otra plata: no toca la caja del bar.'}
          </p>
        </div>
      )}
      {!cashOut && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="exp-date">Fecha</Label>
          <Input
            id="exp-date"
            type="date"
            max={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      )}
      <DialogFooter>
        {overCash && (
          <p className="mr-auto text-label text-destructive">
            En la caja hay {formatCop(cashNow)}.
          </p>
        )}
        <Button disabled={pending || (cashOut && !session) || overCash} onClick={submit}>
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          Registrar gasto
        </Button>
      </DialogFooter>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Gastos fijos (F8-02)
// ---------------------------------------------------------------------------

export function FixedExpensesDialog({
  open,
  onOpenChange,
  fixed,
  categories,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  fixed: FixedExpense[]
  categories: ExpenseCategory[]
}) {
  const { user } = useAuth()
  const [editing, setEditing] = useState<FixedExpense | 'new' | null>(null)
  const fixedCats = categories.filter((c) => c.active && c.kind === 'fijo')
  const name = (id: string) => categories.find((c) => c.id === id)?.name ?? ''
  const total = fixed.filter((f) => f.active).reduce((s, f) => s + f.amount, 0)

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setEditing(null)
        onOpenChange(o)
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-title">Gastos fijos del mes</DialogTitle>
          <DialogDescription className="text-label">
            Lo que pagas todos los meses. Cada mes verás cuáles faltan por pagar, y su total es la
            base del punto de equilibrio. Total: {formatCop(total)} al mes.
          </DialogDescription>
        </DialogHeader>
        {editing ? (
          <FixedForm
            fixed={editing === 'new' ? null : editing}
            categories={fixedCats}
            onDone={() => setEditing(null)}
          />
        ) : (
          <>
            <ul className="divide-y divide-border rounded-xl border">
              {fixed.length === 0 && (
                <li className="px-4 py-6 text-center text-label text-muted-foreground">
                  Aún no tienes gastos fijos.
                </li>
              )}
              {fixed.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 cursor-pointer text-left"
                    onClick={() => setEditing(f)}
                  >
                    <span
                      className={cn('block font-medium', !f.active && 'text-subtle-foreground')}
                    >
                      {f.name}
                    </span>
                    <span className="block text-meta text-subtle-foreground">
                      {name(f.categoryId)}, {formatCop(f.amount)} al mes
                    </span>
                  </button>
                  <Switch
                    checked={f.active}
                    aria-label={`${f.name} activo`}
                    onCheckedChange={(v) =>
                      setFixedExpenseActive(user?.uid ?? '', f, v).catch((e: Error) =>
                        toast.error(e.message),
                      )
                    }
                  />
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button onClick={() => setEditing('new')}>
                <Plus aria-hidden />
                Agregar gasto fijo
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function FixedForm({
  fixed,
  categories,
  onDone,
}: {
  fixed: FixedExpense | null
  categories: ExpenseCategory[]
  onDone: () => void
}) {
  const { user } = useAuth()
  const [name, setName] = useState(fixed?.name ?? '')
  const [categoryId, setCategoryId] = useState(fixed?.categoryId ?? categories[0]?.id ?? '')
  const [amount, setAmount] = useState<number | null>(fixed?.amount ?? null)
  const [pending, setPending] = useState(false)

  async function save() {
    setPending(true)
    try {
      await saveFixedExpense(user?.uid ?? '', fixed, { name, categoryId, amount })
      toast.success('Gasto fijo guardado')
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="fx-name">Nombre</Label>
        <Input
          id="fx-name"
          maxLength={60}
          placeholder="Arriendo del local"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="fx-cat">Categoría</Label>
        <NativeSelect
          id="fx-cat"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="fx-amount">Monto mensual</Label>
        <MoneyInput id="fx-amount" value={amount} onChange={setAmount} />
      </div>
      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onDone}>
          Volver
        </Button>
        <Button disabled={pending} onClick={save}>
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          Guardar
        </Button>
      </DialogFooter>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Categorías de gasto (D-226 #2)
// ---------------------------------------------------------------------------

export function ExpenseCategoriesDialog({
  open,
  onOpenChange,
  categories,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  categories: ExpenseCategory[]
}) {
  const { user } = useAuth()
  const [editing, setEditing] = useState<ExpenseCategory | 'new' | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ExpenseKind>('variable')
  const [pending, setPending] = useState(false)

  function edit(c: ExpenseCategory | 'new') {
    setEditing(c)
    setName(c === 'new' ? '' : c.name)
    setKind(c === 'new' ? 'variable' : c.kind)
  }

  async function save() {
    setPending(true)
    try {
      await saveExpenseCategory(
        user?.uid ?? '',
        editing === 'new' ? null : editing,
        { name, kind },
        categories,
      )
      toast.success('Categoría guardada')
      setEditing(null)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setEditing(null)
        onOpenChange(o)
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-title">Categorías de gasto</DialogTitle>
          <DialogDescription className="text-label">
            Fijo: se paga cada mes. Variable: depende del mes. Inversión: equipos y mejoras; no baja
            la utilidad del mes, se recupera con el tiempo.
          </DialogDescription>
        </DialogHeader>
        {editing ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="cat-name">Nombre</Label>
              <Input
                id="cat-name"
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div role="group" aria-label="Tipo" className="flex gap-2">
              {(['fijo', 'variable', 'inversion'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={choiceClass(kind === k)}
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                >
                  {EXPENSE_KIND_LABELS[k]}
                </button>
              ))}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                Volver
              </Button>
              <Button disabled={pending} onClick={save}>
                {pending && <Loader2 aria-hidden className="animate-spin" />}
                Guardar
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border rounded-xl border">
              {categories.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 cursor-pointer text-left"
                    onClick={() => edit(c)}
                  >
                    <span
                      className={cn('block font-medium', !c.active && 'text-subtle-foreground')}
                    >
                      {c.name}
                    </span>
                    <span className="block text-meta text-subtle-foreground">
                      {EXPENSE_KIND_LABELS[c.kind]}
                    </span>
                  </button>
                  <Switch
                    checked={c.active}
                    aria-label={`${c.name} activa`}
                    onCheckedChange={(v) =>
                      setExpenseCategoryActive(user?.uid ?? '', c, v).catch((e: Error) =>
                        toast.error(e.message),
                      )
                    }
                  />
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button onClick={() => edit('new')}>
                <Plus aria-hidden />
                Nueva categoría
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
