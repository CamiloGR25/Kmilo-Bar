import { useMemo, useState, type ReactNode } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  LayoutGrid,
  ListTodo,
  Loader2,
  ShoppingBag,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { Link } from 'react-router'
import { BUSINESS_NAME } from '@/components/shared/brand'
import { ShareTextDialog } from '@/components/shared/share-text-dialog'
import { StockIndicator } from '@/components/shared/stock-indicator'
import { Button } from '@/components/ui/button'
import {
  addBusinessDays,
  businessDateOf,
  formatBusinessDate,
  formatBusinessDateLong,
} from '@/domain/dates'
import { aggregate, changeBp, dailySeries, type SalesTotals } from '@/domain/metrics/sales-report'
import { formatBp, formatCop, type Bp } from '@/domain/money'
import CashStatus from '@/features/cash/components/cash-status'
import { CHANNEL_LABELS, CHANNELS } from '@/features/cash/domain/payments'
import { ReviewPanel } from '@/features/inventory/components/review-panel'
import { isAlert } from '@/features/inventory/domain/stock'
import { useInventory } from '@/features/inventory/hooks/use-inventory'
import { useOpenOrders } from '@/features/orders/services/orders-service'
import { SalesBarChart } from '@/features/reports/components/sales-bar-chart'
import { daySummaryText } from '@/features/reports/domain/day-summary'
import { useDailyStatsRange } from '@/features/reports/services/daily-stats'
import { useTables } from '@/features/tables/services/tables-service'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'

/**
 * Inicio (Fase 6, D-221): cuánto se vendió hoy (pagado, en cuentas abiertas y total), lo cobrado
 * por medio, la ganancia y las pérdidas, comparado con el mismo día de la semana anterior;
 * revisión de inventario, ventas de 7 días, mesas, alertas de stock y accesos rápidos.
 * Lee 8 documentos de `dailyStats` (hoy, 6 días atrás y el mismo día de la semana pasada).
 */
export function DashboardPage() {
  const now = useNow()
  const today = businessDateOf(now)
  const lastWeek = addBusinessDays(today, -7)
  const stats = useDailyStatsRange(lastWeek, today)
  const orders = useOpenOrders()
  const tables = useTables()
  const inventory = useInventory()
  const [sharing, setSharing] = useState(false)

  const days = useMemo(() => stats.data ?? [], [stats.data])
  const totals = useMemo(
    () => aggregate(days.filter((d) => d.businessDate === today)),
    [days, today],
  )
  const previous = useMemo(
    () => aggregate(days.filter((d) => d.businessDate === lastWeek)),
    [days, lastWeek],
  )
  const week = useMemo(
    () => dailySeries(days, { from: addBusinessDays(today, -6), to: today }),
    [days, today],
  )

  const open = useMemo(() => {
    const list = orders.data ?? []
    return { count: list.length, total: list.reduce((s, o) => s + o.total, 0) }
  }, [orders.data])
  const activeTables = (tables.data ?? []).filter((t) => t.active && t.status !== 'fuera_servicio')
  const busyTables = activeTables.filter((t) => t.currentOrderId).length
  const alerts = (inventory.items ?? []).filter((i) => isAlert(i.level))

  const loading = stats.loading || orders.loading

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 pt-8 pb-16 sm:px-8 sm:pt-12">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <p className="text-label text-muted-foreground first-letter:uppercase">
            Jornada del {formatBusinessDateLong(today)}
          </p>
          <h1 className="mt-1 text-display font-semibold tracking-tight">Inicio</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <CashStatus />
          <Button variant="outline" disabled={loading} onClick={() => setSharing(true)}>
            Resumen de la jornada
          </Button>
        </div>
      </header>

      <ReviewPanel />

      {stats.error && (
        <p role="alert" className="text-destructive">
          No se pudieron cargar las ventas: {stats.error.message}
        </p>
      )}

      <section aria-labelledby="hoy" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="hoy" className="text-title font-semibold">
            Ventas de hoy
          </h2>
          {loading && (
            <span className="inline-flex items-center gap-2 text-label text-muted-foreground">
              <Loader2 aria-hidden className="size-4 animate-spin" /> Cargando…
            </span>
          )}
        </div>
        <dl className="grid divide-border rounded-xl border bg-card max-md:divide-y md:grid-cols-3 md:divide-x">
          <Figure
            label="Vendido (pagado)"
            value={formatCop(totals.salesGross)}
            note={
              <Comparison
                bp={changeBp(totals.salesGross, previous.salesGross)}
                against={formatBusinessDate(lastWeek)}
                count={`${totals.ordersCount} ${totals.ordersCount === 1 ? 'cuenta pagada' : 'cuentas pagadas'}`}
              />
            }
          />
          <Figure
            label="En cuentas abiertas"
            value={formatCop(open.total)}
            note={
              open.count === 0
                ? 'Ninguna cuenta abierta'
                : `${open.count} ${open.count === 1 ? 'cuenta por cobrar' : 'cuentas por cobrar'}`
            }
          />
          <Figure
            label="Total del día"
            value={formatCop(totals.salesGross + open.total)}
            note="Pagado más lo que falta cobrar"
            strong
          />
        </dl>
        <div className="grid gap-4 md:grid-cols-[1.3fr_1fr_1fr]">
          <Collected totals={totals} />
          <Stat
            label="Ganancia bruta"
            value={formatCop(totals.grossProfit)}
            note={
              totals.marginBp !== null
                ? `Margen ${formatBp(totals.marginBp)} sobre lo vendido`
                : 'Aún sin ventas pagadas'
            }
          />
          <Stat
            label="Pérdidas"
            value={formatCop(totals.losses)}
            note="Rotas, vencidas, cortesías, consumo propio y servido no cobrado, a costo"
            tone={totals.losses > 0 ? 'warning' : undefined}
          />
        </div>
      </section>

      <div className="grid gap-10 lg:grid-cols-[1.5fr_1fr]">
        <section aria-labelledby="semana" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="semana" className="text-title font-semibold">
              Ventas de los últimos 7 días
            </h2>
            <Link to="/ventas" className="text-label text-primary-text hover:underline">
              Ver todas las ventas
            </Link>
          </div>
          <div className="rounded-xl border bg-card p-4 sm:p-5">
            <SalesBarChart
              label="Ventas pagadas por día, últimos 7 días"
              highlight={today}
              data={week.map((p) => ({
                key: p.key,
                label: p.label,
                value: p.sales,
                detail: `Ganancia ${formatCop(p.profit)}`,
              }))}
            />
          </div>
        </section>

        <section aria-labelledby="ahora" className="flex flex-col gap-4">
          <h2 id="ahora" className="text-title font-semibold">
            Ahora en el bar
          </h2>
          <div className="flex flex-col divide-y divide-border rounded-xl border bg-card">
            <Link
              to="/mesas"
              className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-raised"
            >
              <span className="text-label text-muted-foreground">Mesas ocupadas</span>
              <span className="tabular text-lg font-semibold">
                {busyTables} de {activeTables.length}
              </span>
            </Link>
            <div className="flex flex-col gap-3 px-5 py-4">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-label text-muted-foreground">Alertas de stock</span>
                <Link
                  to="/inventario/recomendaciones"
                  className="text-label text-primary-text hover:underline"
                >
                  Qué pedir
                </Link>
              </div>
              {alerts.length === 0 ? (
                <p className="text-label text-success">Todo el inventario está sobre el mínimo.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {alerts.slice(0, 5).map((i) => (
                    <li
                      key={i.product.id}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
                    >
                      <Link
                        to={`/inventario/${i.product.id}`}
                        className="min-w-0 truncate font-medium hover:underline"
                      >
                        {i.product.name}
                      </Link>
                      <StockIndicator level={i.level} />
                    </li>
                  ))}
                  {alerts.length > 5 && (
                    <li className="text-meta text-subtle-foreground">
                      y {alerts.length - 5} más en Inventario
                    </li>
                  )}
                </ul>
              )}
            </div>
          </div>
        </section>
      </div>

      <nav aria-label="Accesos rápidos" className="flex flex-col gap-4">
        <h2 className="text-title font-semibold">Accesos rápidos</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Shortcut to="/mesas" icon={LayoutGrid} label="Mesas" />
          <Shortcut to="/barra" icon={ShoppingBag} label="Venta en barra" />
          <Shortcut to="/caja" icon={Wallet} label="Caja" />
          <Shortcut to="/ventas" icon={TrendingUp} label="Ventas" />
          <Shortcut to="/inventario" icon={Boxes} label="Inventario" />
          <Shortcut to="/inventario/recomendaciones" icon={ListTodo} label="Qué pedir" />
        </ul>
      </nav>

      <ShareTextDialog
        title="Resumen de la jornada"
        description="Envíalo por WhatsApp o cópialo. Las cuentas abiertas aún no cuentan como vendidas."
        text={daySummaryText(BUSINESS_NAME, today, totals, open)}
        open={sharing}
        onOpenChange={setSharing}
      />
    </div>
  )
}

function Figure({
  label,
  value,
  note,
  strong,
}: {
  label: string
  value: string
  note: ReactNode
  strong?: boolean
}) {
  return (
    <div className="flex flex-col gap-1 px-5 py-4 sm:py-5">
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'tabular text-figure font-semibold tracking-tight',
          strong && 'text-primary-text',
        )}
      >
        {value}
      </dd>
      <dd className="text-meta text-subtle-foreground">{note}</dd>
    </div>
  )
}

/** Variación frente al mismo día de la semana anterior (D-221). */
function Comparison({ bp, against, count }: { bp: Bp | null; against: string; count: string }) {
  if (bp === null)
    return (
      <>
        {count}. Sin ventas el {against} para comparar.
      </>
    )
  const up = bp >= 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <>
      {count}.{' '}
      <span
        className={cn(
          'inline-flex items-center font-medium',
          up ? 'text-success' : 'text-destructive',
        )}
      >
        <Icon aria-hidden className="size-3.5" />
        {formatBp(Math.abs(bp))}
      </span>{' '}
      {up ? 'más' : 'menos'} que el {against}
    </>
  )
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: string
  note: string
  tone?: 'warning'
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-card px-5 py-4">
      <p className="text-label text-muted-foreground">{label}</p>
      <p className={cn('tabular text-xl font-semibold', tone === 'warning' && 'text-warning')}>
        {value}
      </p>
      <p className="text-meta text-subtle-foreground">{note}</p>
    </div>
  )
}

/** Lo cobrado hoy, por medio y canal (F-06). */
function Collected({ totals }: { totals: SalesTotals }) {
  const rows = [
    { key: 'efectivo', label: 'Efectivo', amount: totals.byMethod.efectivo ?? 0 },
    ...CHANNELS.map((c) => ({
      key: c,
      label: CHANNEL_LABELS[c],
      amount: totals.byChannel[c] ?? 0,
    })),
  ].filter((r) => r.amount !== 0)
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card px-5 py-4">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-label text-muted-foreground">Cobrado</p>
        <p className="tabular text-xl font-semibold">{formatCop(totals.collected)}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-meta text-subtle-foreground">Aún no hay cobros hoy.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((r) => (
            <li key={r.key} className="flex items-baseline justify-between gap-4 text-label">
              <span className="text-muted-foreground">{r.label}</span>
              <span className="tabular font-medium">{formatCop(r.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Shortcut({ to, icon: Icon, label }: { to: string; icon: LucideIcon; label: string }) {
  return (
    <li>
      <Link
        to={to}
        className="flex h-full min-h-20 flex-col justify-between gap-3 rounded-xl border bg-card p-4 font-medium transition-colors hover:border-border-strong hover:bg-raised"
      >
        <Icon aria-hidden className="size-5 text-primary-text" />
        {label}
      </Link>
    </li>
  )
}
