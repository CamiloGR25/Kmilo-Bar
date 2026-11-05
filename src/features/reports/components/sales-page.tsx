import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Page, PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  addBusinessDays,
  businessDateOf,
  daysBetween,
  formatBusinessDate,
  formatBusinessDateLong,
  formatMonth,
  type BusinessDate,
  type BusinessDateRange,
} from '@/domain/dates'
import {
  aggregate,
  categoryRows,
  changeBp,
  comparisonLabel,
  comparisonRange,
  dailySeries,
  hourSeries,
  monthlySeries,
  PERIOD_LABELS,
  periodRange,
  productRows,
  shiftAnchor,
  sortRows,
  topRows,
  type PeriodKind,
  type ProductRow,
  type ProductSortKey,
  type SalesTotals,
} from '@/domain/metrics/sales-report'
import { formatBp, formatCop, type Bp } from '@/domain/money'
import { CHANNEL_LABELS, CHANNELS } from '@/features/cash/domain/payments'
import { useCategories } from '@/features/products/services/catalog-service'
import { cn } from '@/lib/utils'
import { useDailyStatsRange } from '../services/daily-stats'
import { SalesBarChart } from './sales-bar-chart'

const KINDS: PeriodKind[] = ['dia', 'semana', 'mes', 'anio', 'rango']
const MAX_RANGE_DAYS = 366

const LOSS_LABELS: Record<string, string> = {
  merma: 'Merma',
  danado: 'Dañado',
  vencido: 'Vencido',
  cortesia: 'Cortesía',
  consumo_propio: 'Consumo propio',
  ajuste_negativo: 'Ajuste negativo',
  conteo: 'Faltantes en conteos',
}

function periodTitle(kind: PeriodKind, range: BusinessDateRange, today: BusinessDate): string {
  switch (kind) {
    case 'dia':
      return range.from === today
        ? `Hoy, ${formatBusinessDateLong(range.from)}`
        : formatBusinessDateLong(range.from)
    case 'semana':
      return `Semana del ${formatBusinessDate(range.from)} al ${formatBusinessDate(range.to)}`
    case 'mes':
      return formatMonth(range.from)
    case 'anio':
      return `De ${formatMonth(range.from)} a ${formatMonth(range.to)}`
    case 'rango':
      return `Del ${formatBusinessDate(range.from)} al ${formatBusinessDate(range.to)}`
  }
}

/**
 * Ventas (Fase 6, D-221): día, semana, mes, 12 meses o rango; comparación con el periodo
 * anterior; gráficas por día o mes, por hora y por categoría; cobrado por medio; pérdidas; y
 * tabla por producto con ganancia, margen y top 10. Lee un documento de `dailyStats` por día.
 */
export function SalesPage() {
  const [today] = useState(() => businessDateOf(new Date()))
  const [kind, setKind] = useState<PeriodKind>('semana')
  const [anchor, setAnchor] = useState(today)
  const [custom, setCustom] = useState<BusinessDateRange>({
    from: addBusinessDays(today, -13),
    to: today,
  })

  const customError =
    !custom.from || !custom.to
      ? 'Escoge las dos fechas.'
      : daysBetween(custom.from, custom.to) < 0
        ? 'La fecha inicial debe ser anterior a la final.'
        : daysBetween(custom.from, custom.to) + 1 > MAX_RANGE_DAYS
          ? 'Máximo un año por consulta.'
          : null

  const range = kind === 'rango' ? custom : periodRange(kind, anchor)
  const compare = comparisonRange(kind, range)
  const valid = kind !== 'rango' || !customError
  // Una sola consulta: el periodo y su comparación.
  const stats = useDailyStatsRange(valid ? compare.from : today, valid ? range.to : today)
  const categories = useCategories()

  const days = useMemo(() => stats.data ?? [], [stats.data])
  const current = useMemo(
    () => days.filter((d) => d.businessDate >= range.from && d.businessDate <= range.to),
    [days, range.from, range.to],
  )
  const totals = useMemo(() => aggregate(current), [current])
  const previous = useMemo(
    () =>
      aggregate(days.filter((d) => d.businessDate >= compare.from && d.businessDate <= compare.to)),
    [days, compare.from, compare.to],
  )
  const categoryName = useMemo(() => {
    const m = new Map((categories.data ?? []).map((c) => [c.id, c.name]))
    return (id: string) => m.get(id) ?? 'Sin categoría'
  }, [categories.data])

  const series =
    kind === 'anio'
      ? monthlySeries(current, range)
      : kind === 'dia'
        ? []
        : dailySeries(current, range)
  const hours = hourSeries(totals.byHour)
  const cats = categoryRows(totals.byCategory)
  const against = comparisonLabel(kind, range)
  const isCurrent = kind !== 'rango' && range.to >= today

  return (
    <Page wide>
      <PageHeader
        title="Ventas"
        description="Lo vendido y cobrado en cuentas pagadas, con su ganancia, por día, semana o mes."
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

        {kind === 'rango' ? (
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1.5 text-label text-muted-foreground">
              Desde
              <Input
                type="date"
                max={today}
                value={custom.from}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-label text-muted-foreground">
              Hasta
              <Input
                type="date"
                max={today}
                value={custom.to}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
              />
            </label>
            {customError && <p className="pb-3 text-label text-destructive">{customError}</p>}
          </div>
        ) : (
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
              {periodTitle(kind, range, today)}
            </p>
            {!isCurrent && (
              <Button variant="ghost" size="sm" onClick={() => setAnchor(today)}>
                Volver a hoy
              </Button>
            )}
          </div>
        )}
      </div>

      {stats.error && (
        <p role="alert" className="text-destructive">
          No se pudieron cargar las ventas: {stats.error.message}
        </p>
      )}

      {valid && stats.loading ? (
        <p className="inline-flex items-center gap-2 text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Cargando…
        </p>
      ) : valid ? (
        <>
          <Summary totals={totals} previous={previous} against={against} />

          {series.length > 0 && (
            <ChartSection
              title={kind === 'anio' ? 'Ventas por mes' : 'Ventas por día'}
              note="Cuentas pagadas, por jornada (de 6 a. m. a 6 a. m.)."
            >
              <SalesBarChart
                label={kind === 'anio' ? 'Ventas pagadas por mes' : 'Ventas pagadas por día'}
                highlight={kind === 'anio' ? today.slice(0, 7) : today}
                height={260}
                data={series.map((p) => ({
                  key: p.key,
                  label: p.label,
                  value: p.sales,
                  detail: `Ganancia ${formatCop(p.profit)}`,
                }))}
              />
            </ChartSection>
          )}

          <div className="grid gap-8 lg:grid-cols-2">
            <ChartSection
              title="Horas pico"
              note="Ventas según la hora en que se pidió cada ronda."
            >
              <SalesBarChart
                label="Ventas por hora del día"
                data={hours.map((h) => ({ key: String(h.hour), label: h.label, value: h.sales }))}
              />
            </ChartSection>
            <ChartSection title="Por categoría" note="Ventas de cada categoría en el periodo.">
              <SalesBarChart
                horizontal
                label="Ventas por categoría"
                height={Math.max(160, cats.length * 34 + 40)}
                data={cats.map((c) => ({
                  key: c.id,
                  label: categoryName(c.id),
                  value: c.sales,
                  detail: `${c.qty} unidades, ganancia ${formatCop(c.profit)}`,
                }))}
              />
            </ChartSection>
          </div>

          <div className="grid gap-8 lg:grid-cols-2">
            <CollectedSection totals={totals} />
            <LossesSection totals={totals} />
          </div>

          <ProductsSection rows={productRows(totals.byProduct)} categoryName={categoryName} />
        </>
      ) : null}
    </Page>
  )
}

function ChartSection({
  title,
  note,
  children,
}: {
  title: string
  note: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-title font-semibold">{title}</h2>
        <p className="text-label text-muted-foreground">{note}</p>
      </div>
      <div className="rounded-xl border bg-card p-4 sm:p-5">{children}</div>
    </section>
  )
}

function Change({ bp, against }: { bp: Bp | null; against: string }) {
  if (bp === null) return <>Sin ventas en {against} para comparar.</>
  const up = bp >= 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <>
      <span
        className={cn(
          'inline-flex items-center font-medium',
          up ? 'text-success' : 'text-destructive',
        )}
      >
        <Icon aria-hidden className="size-3.5" />
        {formatBp(Math.abs(bp))}
      </span>{' '}
      {up ? 'más' : 'menos'} que {against}
    </>
  )
}

function Summary({
  totals,
  previous,
  against,
}: {
  totals: SalesTotals
  previous: SalesTotals
  against: string
}) {
  const cells: { label: string; value: string; note: ReactNode }[] = [
    {
      label: 'Vendido',
      value: formatCop(totals.salesGross),
      note: <Change bp={changeBp(totals.salesGross, previous.salesGross)} against={against} />,
    },
    {
      label: 'Ganancia bruta',
      value: formatCop(totals.grossProfit),
      note:
        totals.marginBp !== null ? (
          <>
            Margen {formatBp(totals.marginBp)}.{' '}
            <Change bp={changeBp(totals.grossProfit, previous.grossProfit)} against={against} />
          </>
        ) : (
          'Sin ventas en el periodo'
        ),
    },
    {
      label: 'Cuentas pagadas',
      value: String(totals.ordersCount),
      note: totals.avgTicket !== null ? `Promedio por cuenta: ${formatCop(totals.avgTicket)}` : '—',
    },
    {
      label: 'Pérdidas',
      value: formatCop(totals.losses),
      note: 'A costo: inventario sin venta y servido no cobrado',
    },
  ]
  return (
    <dl className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 xl:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className="flex min-w-0 flex-col gap-1 bg-card px-5 py-4 sm:py-5">
          <dt className="text-label text-muted-foreground">{c.label}</dt>
          <dd className="tabular text-figure font-semibold tracking-tight">{c.value}</dd>
          <dd className="text-meta text-subtle-foreground">{c.note}</dd>
        </div>
      ))}
    </dl>
  )
}

function ListSection({
  title,
  note,
  rows,
  empty,
  total,
}: {
  title: string
  note: string
  rows: { key: string; label: string; amount: number; tone?: string }[]
  empty: string
  total: { label: string; amount: number }
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-title font-semibold">{title}</h2>
        <p className="text-label text-muted-foreground">{note}</p>
      </div>
      <div className="flex flex-col gap-2 rounded-xl border bg-card px-5 py-4">
        {rows.length === 0 ? (
          <p className="text-label text-muted-foreground">{empty}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rows.map((r) => (
              <li key={r.key} className="flex items-baseline justify-between gap-4">
                <span className="text-muted-foreground">{r.label}</span>
                <span className={cn('tabular font-medium', r.tone)}>{formatCop(r.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 flex items-baseline justify-between gap-4 border-t pt-3 font-semibold">
          <span>{total.label}</span>
          <span className="tabular">{formatCop(total.amount)}</span>
        </p>
      </div>
    </section>
  )
}

function CollectedSection({ totals }: { totals: SalesTotals }) {
  const rows = [
    { key: 'efectivo', label: 'Efectivo', amount: totals.byMethod.efectivo ?? 0 },
    ...CHANNELS.map((c) => ({
      key: c,
      label: CHANNEL_LABELS[c],
      amount: totals.byChannel[c] ?? 0,
    })),
  ].filter((r) => r.amount !== 0)
  return (
    <ListSection
      title="Cobrado por medio"
      note="Pagos recibidos, incluidos los abonos de cuentas que siguen abiertas."
      rows={rows}
      empty="Sin cobros en el periodo."
      total={{ label: 'Total cobrado', amount: totals.collected }}
    />
  )
}

function LossesSection({ totals }: { totals: SalesTotals }) {
  const rows = [
    ...Object.entries(totals.byLossType)
      .filter(([, v]) => (v ?? 0) > 0)
      .map(([k, v]) => ({ key: k, label: LOSS_LABELS[k] ?? k, amount: v ?? 0 })),
    ...(totals.orderLosses > 0
      ? [{ key: 'servido', label: 'Servido y no cobrado', amount: totals.orderLosses }]
      : []),
  ].sort((a, b) => b.amount - a.amount)
  if (totals.invGains > 0) {
    rows.push({
      key: 'sobrantes',
      label: 'Sobrantes (ajustes y conteos a favor, no se restan)',
      amount: totals.invGains,
      tone: 'text-success',
    } as (typeof rows)[number])
  }
  return (
    <ListSection
      title="Pérdidas"
      note="Lo que salió sin venderse, valorado a lo que costó."
      rows={rows}
      empty="Sin pérdidas en el periodo."
      total={{ label: 'Total pérdidas', amount: totals.losses }}
    />
  )
}

const COLUMNS: { key: ProductSortKey; label: string; numeric?: boolean }[] = [
  { key: 'name', label: 'Producto' },
  { key: 'qty', label: 'Cantidad', numeric: true },
  { key: 'sales', label: 'Ventas', numeric: true },
  { key: 'profit', label: 'Ganancia', numeric: true },
  { key: 'marginBp', label: 'Margen', numeric: true },
]

function ProductsSection({
  rows,
  categoryName,
}: {
  rows: ProductRow[]
  categoryName: (id: string) => string
}) {
  const [topBy, setTopBy] = useState<'qty' | 'profit'>('qty')
  const [sort, setSort] = useState<{ key: ProductSortKey; desc: boolean }>({
    key: 'sales',
    desc: true,
  })
  const top = topRows(rows, topBy)
  const sorted = sortRows(rows, sort.key, sort.desc)
  const maxTop = Math.max(1, ...top.map((r) => r[topBy]))

  if (rows.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">Por producto</h2>
        <p className="rounded-xl border border-dashed px-5 py-8 text-center text-label text-muted-foreground">
          Sin productos vendidos en este periodo.
        </p>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-title font-semibold">Top 10</h2>
            <p className="text-label text-muted-foreground">
              {topBy === 'qty' ? 'Los que más se venden.' : 'Los que más ganancia dejan.'}
            </p>
          </div>
          <div role="group" aria-label="Ordenar el top" className="flex gap-2">
            <Button
              variant={topBy === 'qty' ? 'default' : 'outline'}
              aria-pressed={topBy === 'qty'}
              onClick={() => setTopBy('qty')}
            >
              Más vendidos
            </Button>
            <Button
              variant={topBy === 'profit' ? 'default' : 'outline'}
              aria-pressed={topBy === 'profit'}
              onClick={() => setTopBy('profit')}
            >
              Más ganancia
            </Button>
          </div>
        </div>
        <ol className="flex flex-col divide-y divide-border rounded-xl border bg-card">
          {top.map((r, i) => (
            <li
              key={r.id}
              className="grid grid-cols-[2rem_1fr_auto] items-center gap-x-3 px-4 py-3"
            >
              <span className="tabular text-label text-subtle-foreground">{i + 1}</span>
              <div className="min-w-0">
                <p className="truncate font-medium">{r.name}</p>
                <div aria-hidden className="mt-1.5 h-1.5 rounded-full bg-raised">
                  <div
                    className="h-full rounded-full bg-chart-1"
                    style={{ width: `${Math.max(2, (r[topBy] / maxTop) * 100)}%` }}
                  />
                </div>
              </div>
              <p className="text-right tabular font-semibold">
                {topBy === 'qty' ? `${r.qty} unid.` : formatCop(r.profit)}
                <span className="block text-meta font-normal text-subtle-foreground">
                  {topBy === 'qty' ? formatCop(r.sales) : `${r.qty} unid.`}
                </span>
              </p>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-title font-semibold">Todos los productos</h2>
          <p className="text-label text-muted-foreground">
            Toca un encabezado para ordenar. Costo y ganancia según el costo promedio de cada venta.
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[40rem] text-label">
            <thead>
              <tr className="border-b">
                {COLUMNS.map((c) => {
                  const active = sort.key === c.key
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}
                      className={cn(
                        'px-4 py-3 font-medium',
                        c.numeric ? 'text-right' : 'text-left',
                      )}
                    >
                      <button
                        type="button"
                        className={cn(
                          'cursor-pointer hover:text-foreground',
                          active ? 'text-foreground' : 'text-muted-foreground',
                        )}
                        onClick={() =>
                          setSort((s) =>
                            s.key === c.key
                              ? { key: c.key, desc: !s.desc }
                              : { key: c.key, desc: c.key !== 'name' },
                          )
                        }
                      >
                        {c.label}
                        {active && (sort.desc ? ' ↓' : ' ↑')}
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{r.name}</span>
                    <span className="block text-meta text-subtle-foreground">
                      {categoryName(r.categoryId)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular">{r.qty}</td>
                  <td className="px-4 py-2.5 text-right tabular">{formatCop(r.sales)}</td>
                  <td className="px-4 py-2.5 text-right tabular">{formatCop(r.profit)}</td>
                  <td className="px-4 py-2.5 text-right tabular">
                    {r.marginBp !== null ? formatBp(r.marginBp) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
