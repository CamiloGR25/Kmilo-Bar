import { useMemo, useState } from 'react'
import {
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Settings2,
  Tags,
} from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Page, PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import {
  addBusinessMonths,
  businessDateOf,
  formatBusinessDate,
  formatMonth,
  monthRangeOf,
} from '@/domain/dates'
import { formatCop } from '@/domain/money'
import { useAuth } from '@/features/auth/use-auth'
import { useSupplierPaymentsInRange } from '@/features/purchases/services/purchases-service'
import { cn } from '@/lib/utils'
import { EXPENSE_KIND_LABELS, pendingFixed, periodOf, type Expense } from '../domain/finance'
import {
  useExpenseCategories,
  useExpenses,
  useFixedExpenses,
  voidExpense,
} from '../services/finance-service'
import {
  ExpenseCategoriesDialog,
  ExpenseDialog,
  FixedExpensesDialog,
  type ExpensePreset,
} from './expense-dialogs'

interface Row {
  key: string
  date: string
  title: string
  detail: string
  amount: number
  kindLabel: string
  voided: boolean
  expense?: Expense
  orderId?: string
}

/**
 * Gastos (F8-01/02, D-226): gastos del mes, gastos fijos pendientes y pagos a proveedores como
 * "Compra de mercancía" (flujo de caja, no utilidad: D-226 #10).
 */
export function ExpensesPage() {
  const [today] = useState(() => businessDateOf(new Date()))
  const [month, setMonth] = useState(today)
  const range = monthRangeOf(month)
  const categories = useExpenseCategories()
  const fixed = useFixedExpenses()
  const expenses = useExpenses(range.from, range.to)
  const supplierPays = useSupplierPaymentsInRange(range.from, range.to)
  const { user } = useAuth()
  const [newExpense, setNewExpense] = useState<ExpensePreset | null>(null)
  const [managingFixed, setManagingFixed] = useState(false)
  const [managingCats, setManagingCats] = useState(false)
  const [voiding, setVoiding] = useState<Expense | null>(null)

  const cats = categories.data ?? []
  const list = useMemo(() => expenses.data ?? [], [expenses.data])
  const active = list.filter((e) => e.status === 'activo')
  const sum = (k: Expense['kind']) =>
    active.filter((e) => e.kind === k).reduce((s, e) => s + e.amount, 0)
  const merch = (supplierPays.data ?? []).reduce((s, p) => s + p.amount, 0)
  const pending = pendingFixed(fixed.data ?? [], list, periodOf(month))
  const isCurrent = periodOf(month) === periodOf(today)

  const rows = useMemo<Row[]>(() => {
    const r: Row[] = list.map((e) => ({
      key: e.id,
      date: e.businessDate,
      title: e.categoryName,
      detail: [e.description, e.fromCash ? 'de la caja' : 'por fuera'].filter(Boolean).join(', '),
      amount: e.amount,
      kindLabel: EXPENSE_KIND_LABELS[e.kind],
      voided: e.status === 'anulado',
      expense: e,
    }))
    for (const p of supplierPays.data ?? []) {
      r.push({
        key: p.id,
        date: p.businessDate,
        title: 'Compra de mercancía',
        detail: p.fromCash ? 'de la caja' : 'por fuera',
        amount: p.amount,
        kindLabel: 'Proveedor',
        voided: false,
        orderId: p.purchaseOrderId,
      })
    }
    return r.sort((a, b) => b.date.localeCompare(a.date))
  }, [list, supplierPays.data])

  const loading = expenses.loading || categories.loading

  return (
    <Page>
      <PageHeader
        title="Gastos"
        description="Lo que pagas para que el bar funcione. Las compras de mercancía se ven aquí, pero se restan de la utilidad cuando se venden."
        actions={
          <>
            <Button variant="outline" onClick={() => setManagingCats(true)}>
              <Tags aria-hidden />
              Categorías
            </Button>
            <Button variant="outline" onClick={() => setManagingFixed(true)}>
              <Settings2 aria-hidden />
              Gastos fijos
            </Button>
            <Button onClick={() => setNewExpense({})}>
              <Plus aria-hidden />
              Nuevo gasto
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Mes anterior"
          onClick={() => setMonth((m) => addBusinessMonths(m, -1))}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Mes siguiente"
          disabled={isCurrent}
          onClick={() => setMonth((m) => addBusinessMonths(m, 1))}
        >
          <ChevronRight aria-hidden />
        </Button>
        <p className="px-2 text-lg font-semibold first-letter:uppercase">{formatMonth(month)}</p>
        {!isCurrent && (
          <Button variant="ghost" onClick={() => setMonth(today)}>
            Volver a este mes
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-5">
        <Figure label="Fijos" value={sum('fijo')} />
        <Figure label="Variables" value={sum('variable')} />
        <Figure label="Inversión" value={sum('inversion')} note="No baja la utilidad" />
        <Figure label="Compras de mercancía" value={merch} note="Se resta al vender" />
        <Figure
          label="Total pagado"
          value={sum('fijo') + sum('variable') + sum('inversion') + merch}
          strong
        />
      </dl>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-title font-semibold">Gastos fijos del mes</h2>
          {(fixed.data ?? []).length > 0 && (
            <p className="text-label text-muted-foreground">
              {pending.length === 0 ? 'Todos pagados' : `Faltan ${pending.length}`}
            </p>
          )}
        </div>
        {(fixed.data ?? []).filter((f) => f.active).length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed px-5 py-4">
            <p className="text-label text-muted-foreground">
              Define lo que pagas cada mes (arriendo, internet, nómina…) y aquí verás cuáles faltan.
            </p>
            <Button variant="outline" onClick={() => setManagingFixed(true)}>
              Definir gastos fijos
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-xl border bg-card">
            {(fixed.data ?? [])
              .filter((f) => f.active)
              .map((f) => {
                const paid = list.find(
                  (e) =>
                    e.status === 'activo' &&
                    e.fixedExpenseId === f.id &&
                    e.period === periodOf(month),
                )
                return (
                  <li
                    key={f.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5"
                  >
                    <div>
                      <p className="font-medium">{f.name}</p>
                      <p className="text-meta text-subtle-foreground">
                        {formatCop(f.amount)} al mes
                      </p>
                    </div>
                    {paid ? (
                      <span className="inline-flex items-center gap-1.5 text-label font-medium text-success">
                        <CalendarCheck aria-hidden className="size-4" />
                        Pagado el {formatBusinessDate(paid.businessDate)}: {formatCop(paid.amount)}
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() =>
                          setNewExpense({
                            categoryId: f.categoryId,
                            amount: f.amount,
                            description: f.name,
                            fixedExpenseId: f.id,
                          })
                        }
                      >
                        Pagar {formatCop(f.amount)}
                      </Button>
                    )}
                  </li>
                )
              })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">Movimientos del mes</h2>
        {loading ? (
          <p className="inline-flex items-center gap-2 text-muted-foreground">
            <Loader2 aria-hidden className="size-4 animate-spin" /> Cargando…
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-dashed px-5 py-8 text-center text-label text-muted-foreground">
            Sin gastos en este mes.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border bg-card">
            {rows.map((r) => (
              <li key={r.key} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p
                    className={cn('font-medium', r.voided && 'text-subtle-foreground line-through')}
                  >
                    {r.orderId ? (
                      <Link to={`/compras/${r.orderId}`} className="hover:underline">
                        {r.title}
                      </Link>
                    ) : (
                      r.title
                    )}
                  </p>
                  <p className="truncate text-meta text-subtle-foreground">
                    {formatBusinessDate(r.date)}, {r.kindLabel.toLowerCase()}
                    {r.detail && `, ${r.detail}`}
                    {r.voided && r.expense?.voidReason && `. Anulado: ${r.expense.voidReason}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'tabular font-semibold',
                      r.voided && 'text-subtle-foreground line-through',
                    )}
                  >
                    {formatCop(r.amount)}
                  </span>
                  {r.expense && !r.voided && (
                    <Button variant="ghost" onClick={() => setVoiding(r.expense!)}>
                      Anular
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ExpenseDialog
        open={newExpense !== null}
        onOpenChange={(o) => !o && setNewExpense(null)}
        categories={cats}
        preset={newExpense ?? {}}
      />
      <FixedExpensesDialog
        open={managingFixed}
        onOpenChange={setManagingFixed}
        fixed={fixed.data ?? []}
        categories={cats}
      />
      <ExpenseCategoriesDialog
        open={managingCats}
        onOpenChange={setManagingCats}
        categories={cats}
      />
      <ConfirmDialog
        open={voiding !== null}
        onOpenChange={(o) => !o && setVoiding(null)}
        title="Anular gasto"
        destructive
        requireReason
        confirmLabel="Anular"
        description={
          voiding?.fromCash
            ? 'El gasto queda anulado (no se borra). El efectivo vuelve a la caja solo si la caja sigue abierta; si ya se cerró, no se puede anular.'
            : 'El gasto queda anulado (no se borra) y deja de contar en las finanzas.'
        }
        onConfirm={async (reason) => {
          if (!voiding) return
          try {
            await voidExpense(user?.uid ?? '', voiding, reason ?? '')
            toast.success('Gasto anulado')
          } catch (e) {
            toast.error((e as Error).message)
          }
        }}
      />
    </Page>
  )
}

function Figure({
  label,
  value,
  note,
  strong,
}: {
  label: string
  value: number
  note?: string
  strong?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-card px-5 py-4">
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className={cn('tabular text-xl font-semibold', strong && 'text-primary-text')}>
        {formatCop(value)}
      </dd>
      {note && <dd className="text-meta text-subtle-foreground">{note}</dd>}
    </div>
  )
}
