import { useMemo } from 'react'
import { Link } from 'react-router'
import { monthRangeOf, type BusinessDate } from '@/domain/dates'
import { mergeDeltas } from '@/domain/metrics/daily-stats'
import { formatBp, formatCop } from '@/domain/money'
import { useDailyStatsRange } from '@/features/reports/services/daily-stats'
import { cn } from '@/lib/utils'
import {
  breakEven,
  fixedMonthlyTotal,
  incomeStatement,
  monthProgress,
  pendingFixed,
  periodOf,
} from '../domain/finance'
import { useExpenses, useFixedExpenses } from '../services/finance-service'

/** Tarjeta del mes en Inicio (D-226 #9): utilidad, punto de equilibrio y fijos pendientes. */
export function FinanceCard({ today }: { today: BusinessDate }) {
  const range = monthRangeOf(today)
  const stats = useDailyStatsRange(range.from, today)
  const fixed = useFixedExpenses()
  const expenses = useExpenses(range.from, range.to)

  const month = useMemo(() => mergeDeltas(...(stats.data ?? [])), [stats.data])
  const st = incomeStatement(month)
  const fixedTotal = fixedMonthlyTotal(fixed.data ?? [])
  const be = breakEven(fixedTotal, month)
  const progress = be.sales ? monthProgress(month.salesGross ?? 0, be.sales, today) : null
  const pending = pendingFixed(fixed.data ?? [], expenses.data ?? [], periodOf(today))

  return (
    <section aria-labelledby="mes" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="mes" className="text-title font-semibold">
          Este mes
        </h2>
        <Link to="/finanzas" className="text-label text-primary-text hover:underline">
          Ver finanzas
        </Link>
      </div>
      <div className="grid gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-3">
        <div className="flex flex-col gap-1 bg-card px-5 py-4">
          <p className="text-label text-muted-foreground">Utilidad del mes</p>
          <p
            className={cn(
              'tabular text-xl font-semibold',
              st.operatingProfit < 0 ? 'text-destructive' : 'text-success',
            )}
          >
            {formatCop(st.operatingProfit)}
          </p>
          <p className="text-meta text-subtle-foreground">Ventas menos costo, pérdidas y gastos</p>
        </div>
        <div className="flex flex-col gap-2 bg-card px-5 py-4">
          <p className="text-label text-muted-foreground">Punto de equilibrio</p>
          {progress && be.sales ? (
            <>
              <div aria-hidden className="h-2.5 overflow-hidden rounded-full bg-raised">
                <div
                  className={cn(
                    'h-full rounded-full',
                    progress.progressBp >= 10000 ? 'bg-success' : 'bg-chart-1',
                  )}
                  style={{ width: `${Math.min(100, progress.progressBp / 100)}%` }}
                />
              </div>
              <p className="text-meta text-subtle-foreground">
                {formatBp(progress.progressBp)} de {formatCop(be.sales)}
                {progress.perDay ? `, faltan ${formatCop(progress.perDay)} por día` : ', cubierto'}
              </p>
            </>
          ) : (
            <p className="text-meta text-subtle-foreground">{be.reason}</p>
          )}
        </div>
        <Link
          to="/gastos"
          className="flex flex-col gap-1 bg-card px-5 py-4 transition-colors hover:bg-raised"
        >
          <p className="text-label text-muted-foreground">Gastos fijos</p>
          <p
            className={cn(
              'text-xl font-semibold',
              pending.length > 0 ? 'text-warning' : 'text-success',
            )}
          >
            {fixedTotal === 0
              ? 'Sin definir'
              : pending.length === 0
                ? 'Al día'
                : `Faltan ${pending.length}`}
          </p>
          <p className="text-meta text-subtle-foreground">
            {pending.length > 0
              ? `${formatCop(pending.reduce((s, f) => s + f.amount, 0))} por pagar`
              : `${formatCop(fixedTotal)} al mes`}
          </p>
        </Link>
      </div>
    </section>
  )
}
