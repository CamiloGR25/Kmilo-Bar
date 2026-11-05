import { useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCop, formatCopCompact } from '@/domain/money'
import { cn } from '@/lib/utils'

export interface BarPoint {
  key: string
  label: string
  value: number
  /** Línea extra en el tooltip (p. ej. la ganancia). */
  detail?: string
}

/**
 * Barras de una sola serie (dataviz: un tono, sin leyenda; el título nombra la serie).
 * Barras delgadas con extremo redondeado, cuadrícula tenue, tooltip al pasar y vista en tabla.
 * `highlight` resalta una barra (p. ej. hoy) bajando la opacidad de las demás.
 */
export function SalesBarChart({
  data,
  label,
  highlight,
  height = 220,
  horizontal,
}: {
  data: readonly BarPoint[]
  /** Nombre de la serie para lectores de pantalla y la tabla. */
  label: string
  highlight?: string
  height?: number
  horizontal?: boolean
}) {
  const [asTable, setAsTable] = useState(false)
  const empty = data.every((d) => d.value === 0)

  return (
    <div className="flex flex-col gap-2">
      {empty ? (
        <p className="grid place-items-center rounded-lg border border-dashed py-10 text-label text-muted-foreground">
          Sin ventas en este periodo.
        </p>
      ) : asTable ? (
        <table className="w-full text-label">
          <caption className="sr-only">{label}</caption>
          <tbody className="divide-y divide-border">
            {data.map((d) => (
              <tr key={d.key}>
                <th scope="row" className="py-1.5 text-left font-normal text-muted-foreground">
                  {d.label}
                </th>
                <td className="py-1.5 text-right tabular font-medium">{formatCop(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div role="img" aria-label={label} style={{ height }} className="w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data as BarPoint[]}
              layout={horizontal ? 'vertical' : 'horizontal'}
              margin={{ top: 8, right: 8, bottom: 0, left: horizontal ? 8 : 0 }}
              barCategoryGap={horizontal ? 6 : '25%'}
            >
              <CartesianGrid
                stroke="var(--border)"
                strokeDasharray="0"
                vertical={Boolean(horizontal)}
                horizontal={!horizontal}
              />
              {horizontal ? (
                <>
                  <XAxis
                    type="number"
                    tickFormatter={formatCopCompact}
                    tick={{ fill: 'var(--subtle-foreground)', fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={120}
                    tick={{ fill: 'var(--muted-foreground)', fontSize: 13 }}
                    axisLine={false}
                    tickLine={false}
                  />
                </>
              ) : (
                <>
                  <XAxis
                    dataKey="label"
                    tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                    axisLine={{ stroke: 'var(--border-strong)' }}
                    tickLine={false}
                    interval="preserveStartEnd"
                    minTickGap={8}
                  />
                  <YAxis
                    tickFormatter={formatCopCompact}
                    tick={{ fill: 'var(--subtle-foreground)', fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    width={72}
                  />
                </>
              )}
              <Tooltip
                cursor={{ fill: 'var(--raised)', opacity: 0.6 }}
                content={<ChartTooltip />}
              />
              <Bar
                dataKey="value"
                radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
                maxBarSize={horizontal ? 22 : 36}
                isAnimationActive={false}
              >
                {data.map((d) => (
                  <Cell
                    key={d.key}
                    fill="var(--chart-1)"
                    fillOpacity={highlight && d.key !== highlight ? 0.55 : 1}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {!empty && (
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          className={cn('w-fit cursor-pointer text-meta text-primary-text hover:underline')}
        >
          {asTable ? 'Ver como gráfica' : 'Ver como tabla'}
        </button>
      )}
    </div>
  )
}

/** Tooltip de una barra (Recharts le pasa `active` y `payload`). */
function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: readonly { payload?: BarPoint }[]
}) {
  const p = active ? payload?.[0]?.payload : undefined
  if (!p) return null
  return (
    <div className="rounded-lg border border-border-strong bg-popover px-3 py-2 shadow-lg shadow-black/30">
      <p className="text-meta text-muted-foreground first-letter:uppercase">{p.label}</p>
      <p className="tabular font-semibold">{formatCop(p.value)}</p>
      {p.detail && <p className="text-meta text-muted-foreground">{p.detail}</p>}
    </div>
  )
}
