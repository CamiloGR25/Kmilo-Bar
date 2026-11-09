import { useMemo, useState, type ReactNode } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Landmark,
  Loader2,
} from 'lucide-react'
import { Link } from 'react-router'
import { Page, PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import {
  businessDateOf,
  formatBusinessDate,
  formatMonth,
  monthRangeOf,
  type BusinessDateRange,
} from '@/domain/dates'
import { mergeDeltas } from '@/domain/metrics/daily-stats'
import {
  changeBp,
  comparisonLabel,
  comparisonRange,
  PERIOD_LABELS,
  periodRange,
  shiftAnchor,
  type PeriodKind,
} from '@/domain/metrics/sales-report'
import { formatBp, formatCop, type Bp } from '@/domain/money'
import { SalesBarChart } from '@/features/reports/components/sales-bar-chart'
import { useDailyStatsRange } from '@/features/reports/services/daily-stats'
import { cn } from '@/lib/utils'
import {
  breakEven,
  merchandiseFlow,
  cashFlow,
  fixedMonthlyTotal,
  incomeStatement,
  monthProgress,
  recovery,
  type IncomeStatement,
} from '../domain/finance'
import { useFixedExpenses } from '../services/finance-service'
import { useProducts } from '@/features/products/services/catalog-service'

const KINDS: Exclude<PeriodKind, 'rango'>[] = ['dia', 'semana', 'mes', 'anio']
/** Desde cuándo se leen los días para la recuperación (todo el historial del bar). */
const SINCE = '2020-01-01'

function periodTitle(kind: PeriodKind, r: BusinessDateRange) {
  if (kind === 'dia') return formatBusinessDate(r.from)
  if (kind === 'semana')
    return `Semana del ${formatBusinessDate(r.from)} al ${formatBusinessDate(r.to)}`
  if (kind === 'mes') return formatMonth(r.from)
  return `De ${formatMonth(r.from)} a ${formatMonth(r.to)}`
}

/**
 * Finanzas (Fase 8, D-226): estado de resultados y flujo de caja por periodo, punto de
 * equilibrio del mes y recuperación de la inversión desde el primer día. R-FIN-06: las
 * proyecciones dicen "Estimación, no garantía".
 */
export function FinancePage() {
  const [today] = useState(() => businessDateOf(new Date()))
  const [kind, setKind] = useState<Exclude<PeriodKind, 'rango'>>('mes')
  const [anchor, setAnchor] = useState(today)
  const range = periodRange(kind, anchor)
  const compare = comparisonRange(kind, range)
  const all = useDailyStatsRange(SINCE, today)
  const fixed = useFixedExpenses()

  const days = useMemo(() => all.data ?? [], [all.data])
  const inRange = (r: BusinessDateRange) =>
    mergeDeltas(...days.filter((d) => d.businessDate >= r.from && d.businessDate <= r.to))
  const cur = inRange(range)
  const prev = inRange(compare)
  const st = incomeStatement(cur)
  const pst = incomeStatement(prev)
  const flow = cashFlow(cur)
  const month = inRange(monthRangeOf(today))
  const fixedTotal = fixedMonthlyTotal(fixed.data ?? [])
  const be = breakEven(fixedTotal, month)
  const monthFrom = monthRangeOf(today).from
  const monthDaysWithSales = days.filter(
    (d) => d.businessDate >= monthFrom && d.businessDate <= today && (d.salesGross ?? 0) > 0,
  ).length
  const progress = be.sales ? monthProgress(month.salesGross ?? 0, be.sales, today) : null
  const rec = useMemo(() => recovery(days, today), [days, today])
  const products = useProducts()
  const merch = useMemo(() => merchandiseFlow(days, products.data ?? []), [days, products.data])
  const against = comparisonLabel(kind, range)
  const isCurrent = range.to >= today

  return (
    <Page wide>
      <PageHeader
        title="Finanzas"
        description="Cuánto gana el bar, cuánta plata entra y sale, y cuánto falta para recuperar la inversión."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/gastos">Gastos</Link>
            </Button>
            <Button asChild>
              <Link to="/finanzas/capital">
                <Landmark aria-hidden />
                Capital e inversión
              </Link>
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-4">
        <div role="group" aria-label="Periodo" className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <Button
              key={k}
              variant={k === kind ? 'default' : 'outline'}
              aria-pressed={k === kind}
              onClick={() => setKind(k)}
            >
              {PERIOD_LABELS[k]}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Periodo anterior"
            onClick={() => setAnchor((a) => shiftAnchor(kind, a, -1))}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Periodo siguiente"
            disabled={isCurrent}
            onClick={() => setAnchor((a) => shiftAnchor(kind, a, 1))}
          >
            <ChevronRight aria-hidden />
          </Button>
          <p className="px-2 text-lg font-semibold first-letter:uppercase">
            {periodTitle(kind, range)}
          </p>
          {!isCurrent && (
            <Button variant="ghost" onClick={() => setAnchor(today)}>
              Volver a hoy
            </Button>
          )}
        </div>
      </div>

      {all.error && (
        <p role="alert" className="text-destructive">
          No se pudieron cargar las finanzas: {all.error.message}
        </p>
      )}
      {all.loading ? (
        <p className="inline-flex items-center gap-2 text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Cargando…
        </p>
      ) : (
        <>
          <Statement st={st} prev={pst} against={against} />

          <div className="grid gap-8 lg:grid-cols-2">
            <Section
              title="Flujo de caja"
              note="La plata que entró y salió de verdad en el periodo (F-13)."
            >
              <Rows
                rows={[
                  ['Cobrado de ventas', flow.collected],
                  ['Aportes del dueño', flow.capitalIn],
                  ['Entradas extraordinarias', flow.extraIn],
                ]}
                total={['Entró', flow.inTotal]}
              />
              <Rows
                rows={[
                  ['Pagado a proveedores', -flow.supplierPaid],
                  ['Gastos', -flow.expenses],
                  ['Inversión y equipamiento', -flow.investment],
                  ['Retiros de ganancias', -flow.withdrawals],
                ]}
                total={['Salió', -flow.outTotal]}
              />
              <p className="flex justify-between gap-4 rounded-lg bg-raised/60 px-4 py-3 font-semibold">
                <span>Neto del periodo</span>
                <span className={cn('tabular', flow.net < 0 ? 'text-destructive' : 'text-success')}>
                  {formatCop(flow.net)}
                </span>
              </p>
            </Section>

            <Section
              title="Punto de equilibrio del mes"
              note="Lo que hay que vender en el mes para cubrir los gastos fijos (F-16, F-17)."
            >
              <div className="flex flex-col gap-3 rounded-xl border bg-card px-5 py-4">
                {be.sales !== null && monthDaysWithSales < 7 && (
                  <p className="rounded-lg border border-warning/40 bg-warning/8 px-4 py-2 text-label text-warning">
                    Margen provisional: solo {monthDaysWithSales}{' '}
                    {monthDaysWithSales === 1 ? 'día' : 'días'} con ventas este mes. Se estabiliza
                    con 7 o más días.
                  </p>
                )}
                {be.sales === null || !progress ? (
                  <p className="text-label text-muted-foreground">
                    Datos insuficientes: {be.reason}{' '}
                    {fixedTotal <= 0 && (
                      <Link to="/gastos" className="text-primary-text hover:underline">
                        Ir a Gastos
                      </Link>
                    )}
                  </p>
                ) : (
                  <>
                    <p className="text-label text-muted-foreground">
                      Gastos fijos {formatCop(fixedTotal)} con un margen de{' '}
                      {formatBp(be.contributionBp!)}: hay que vender{' '}
                      <span className="font-semibold text-foreground">{formatCop(be.sales)}</span>{' '}
                      en el mes.
                    </p>
                    <div aria-hidden className="h-3 overflow-hidden rounded-full bg-raised">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          progress.progressBp >= 10000 ? 'bg-success' : 'bg-chart-1',
                        )}
                        style={{ width: `${Math.min(100, progress.progressBp / 100)}%` }}
                      />
                    </div>
                    <p className="text-label">
                      Llevas{' '}
                      <span className="tabular font-semibold">
                        {formatCop(month.salesGross ?? 0)}
                      </span>{' '}
                      ({formatBp(progress.progressBp)}).{' '}
                      {progress.perDay
                        ? `Faltan ${formatCop(progress.missing)}: unos ${formatCop(progress.perDay)} por día en los ${progress.daysLeft} días que quedan.`
                        : 'Ya cubriste los gastos fijos del mes.'}
                    </p>
                  </>
                )}
                <p className="text-meta text-subtle-foreground">Estimación, no garantía.</p>
              </div>
            </Section>
          </div>

          <Section
            title="Inventario y mercancía"
            note="Lo que has comprado para vender, lo que ya vendiste y lo que falta por vender. Desde el inicio del bar."
          >
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
              <Cell
                label="Comprado (costo real)"
                value={formatCop(merch.purchased)}
                note="Mercancía recibida: es inversión hasta venderse"
              />
              <Cell
                label="Vendido a costo"
                value={formatCop(merch.soldCost)}
                note={
                  merch.soldBp !== null ? `${formatBp(merch.soldBp)} de lo comprado` : undefined
                }
              />
              <Cell
                label="Por vender a costo"
                value={formatCop(merch.stockCost)}
                note={`A precio de venta ${formatCop(merch.stockSale)}`}
              />
              <Cell
                label="Ganancia potencial"
                value={formatCop(merch.potentialProfit)}
                tone="good"
                note="Si vendes todo el stock actual"
              />
            </dl>
            <dl className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3">
              <Cell label="Ventas acumuladas" value={formatCop(merch.soldSales)} />
              <Cell
                label="Ganancia obtenida"
                value={formatCop(merch.realizedProfit)}
                tone={merch.realizedProfit < 0 ? 'bad' : 'good'}
                note="Ventas − costo de lo vendido"
              />
              <Cell
                label="Otros movimientos"
                value={formatCop(merch.otherMoves)}
                note="Inventario inicial, pérdidas y ajustes"
              />
            </dl>
          </Section>

          <Section
            title="Recuperación de la inversión"
            note="Inversión inicial y equipamiento menos la utilidad acumulada desde el primer día (F-18, F-19)."
          >
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
              <Cell label="Invertido" value={formatCop(rec.totalInvested)} />
              <Cell
                label="Utilidad acumulada"
                value={formatCop(rec.totalProfit)}
                tone={rec.totalProfit < 0 ? 'bad' : 'good'}
              />
              <Cell
                label={rec.pending > 0 ? 'Falta por recuperar' : 'Ya recuperado'}
                value={formatCop(Math.abs(rec.pending))}
                tone={rec.pending > 0 ? 'bad' : 'good'}
                note={rec.totalInvested > 0 ? `${formatBp(rec.recoveredBp)} recuperado` : undefined}
              />
              <Cell
                label="Meses estimados"
                value={
                  rec.pending <= 0 ? 'Listo' : rec.monthsLeft === null ? '—' : `${rec.monthsLeft}`
                }
                note={
                  rec.pending <= 0
                    ? 'La inversión ya se recuperó'
                    : rec.monthsLeft === null
                      ? 'Aún no hay utilidad para estimar'
                      : rec.lowConfidence
                        ? 'Poco confiable: menos de 3 meses de datos'
                        : `Con ${formatCop(rec.avgMonthlyProfit ?? 0)} de utilidad al mes`
                }
              />
            </dl>
            {rec.months.length > 0 && (
              <div className="rounded-xl border bg-card p-4 sm:p-5">
                <p className="mb-2 text-label text-muted-foreground">
                  Falta por recuperar al cierre de cada mes
                </p>
                <SalesBarChart
                  label="Inversión pendiente por mes"
                  data={rec.months.map((m) => ({
                    key: m.key,
                    label: m.label,
                    value: m.pending,
                    detail: `Utilidad del mes ${formatCop(m.operatingProfit)}`,
                  }))}
                />
              </div>
            )}
            <p className="text-meta text-subtle-foreground">
              Estimación, no garantía. Al principio el negocio arranca en negativo por la inversión
              y va subiendo con la utilidad de cada mes.
            </p>
          </Section>
        </>
      )}
    </Page>
  )
}

function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-title font-semibold">{title}</h2>
        <p className="text-label text-muted-foreground">{note}</p>
      </div>
      {children}
    </section>
  )
}

function Rows({ rows, total }: { rows: [string, number][]; total: [string, number] }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border bg-card px-5 py-4 text-label">
      {rows.map(([l, v]) => (
        <p key={l} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{l}</span>
          <span className="tabular">{formatCop(v === 0 ? 0 : v)}</span>
        </p>
      ))}
      <p className="mt-1 flex justify-between gap-4 border-t pt-2 font-semibold">
        <span>{total[0]}</span>
        <span className="tabular">{formatCop(total[1] === 0 ? 0 : total[1])}</span>
      </p>
    </div>
  )
}

function Cell({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: string
  note?: string
  tone?: 'good' | 'bad'
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-card px-5 py-4">
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'tabular text-xl font-semibold',
          tone === 'bad' && 'text-destructive',
          tone === 'good' && 'text-success',
        )}
      >
        {value}
      </dd>
      {note && <dd className="text-meta text-subtle-foreground">{note}</dd>}
    </div>
  )
}

function Change({ cur, prev }: { cur: number; prev: number }) {
  const bp: Bp | null = changeBp(cur, prev)
  if (bp === null) return <span className="text-subtle-foreground">—</span>
  const up = bp >= 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={cn(
        'inline-flex items-center justify-end',
        up ? 'text-success' : 'text-destructive',
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {formatBp(Math.abs(bp))}
    </span>
  )
}

/** Estado de resultados (F-04…F-12) con el periodo anterior. */
function Statement({
  st,
  prev,
  against,
}: {
  st: IncomeStatement
  prev: IncomeStatement
  against: string
}) {
  const rows: {
    label: string
    cur: number
    prev: number
    strong?: boolean
    minus?: boolean
    note?: string
  }[] = [
    { label: 'Ventas', cur: st.sales, prev: prev.sales },
    { label: 'Costo de lo vendido', cur: st.cogs, prev: prev.cogs, minus: true },
    {
      label: 'Utilidad bruta',
      cur: st.grossProfit,
      prev: prev.grossProfit,
      strong: true,
      note: st.grossMarginBp !== null ? `margen ${formatBp(st.grossMarginBp)}` : undefined,
    },
    { label: 'Pérdidas de inventario', cur: st.losses, prev: prev.losses, minus: true },
    { label: 'Gastos fijos', cur: st.fixed, prev: prev.fixed, minus: true },
    { label: 'Gastos variables', cur: st.variable, prev: prev.variable, minus: true },
    {
      label: 'Utilidad operativa',
      cur: st.operatingProfit,
      prev: prev.operatingProfit,
      strong: true,
      note: st.operatingMarginBp !== null ? `margen ${formatBp(st.operatingMarginBp)}` : undefined,
    },
  ]
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-title font-semibold">Estado de resultados</h2>
        <p className="text-label text-muted-foreground">
          Lo que ganó el bar. Las compras de mercancía se restan como costo de lo vendido; la
          inversión no entra aquí.
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[34rem] text-label">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th scope="col" className="px-4 py-3 text-left font-medium">
                Concepto
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Periodo
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium first-letter:uppercase">
                {against}
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Cambio
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.label} className={cn(r.strong && 'bg-raised/40 font-semibold')}>
                <td className="px-4 py-2.5">
                  {r.minus ? `− ${r.label}` : r.label}
                  {r.note && (
                    <span className="block text-meta font-normal text-subtle-foreground">
                      {r.note}
                    </span>
                  )}
                </td>
                <td
                  className={cn(
                    'px-4 py-2.5 text-right tabular',
                    r.strong && r.cur < 0 && 'text-destructive',
                  )}
                >
                  {formatCop(r.cur)}
                </td>
                <td className="px-4 py-2.5 text-right tabular text-muted-foreground">
                  {formatCop(r.prev)}
                </td>
                <td className="px-4 py-2.5 text-right tabular">
                  {r.minus ? (
                    <span className="text-subtle-foreground">—</span>
                  ) : (
                    <Change cur={r.cur} prev={r.prev} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3">
        <div className="flex flex-col gap-1 bg-card px-5 py-4">
          <p className="text-label text-muted-foreground">Compras de mercancía pagadas</p>
          <p className="tabular text-xl font-semibold">{formatCop(st.supplierPaid)}</p>
          <p className="text-meta text-subtle-foreground">
            Salen de la caja o del bolsillo al pagar. No restan la utilidad: esa mercancía se resta
            al venderse. Ver en Gastos.
          </p>
        </div>
        <div className="flex flex-col gap-1 bg-card px-5 py-4">
          <p className="text-label text-muted-foreground">Inversión y equipamiento</p>
          <p className="tabular text-xl font-semibold">{formatCop(st.investment)}</p>
          <p className="text-meta text-subtle-foreground">No baja la utilidad del mes.</p>
        </div>
        <div className="flex flex-col gap-1 bg-card px-5 py-4">
          <p className="text-label text-muted-foreground">Cuentas pagadas</p>
          <p className="tabular text-xl font-semibold">{st.ordersCount}</p>
          {st.avgTicket !== null && (
            <p className="text-meta text-subtle-foreground">
              Ticket promedio {formatCop(st.avgTicket)}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
