import { useState } from 'react'
import { Plus, ReceiptText, ShoppingBag } from 'lucide-react'
import { StockIndicator, type StockLevel } from '@/components/shared/stock-indicator'
import { Button } from '@/components/ui/button'
import { businessDateOf, formatBusinessDateLong, formatTime } from '@/domain/dates'
import { applyBp, formatBp, formatCop, ratioToBp, roundUpToStep } from '@/domain/money'
import { cn } from '@/lib/utils'

/**
 * Vista previa del sistema de diseño (Fase 0). Usa datos de ejemplo.
 * Se reemplaza por el router y el AppShell en la Fase 1.
 */

type TableState = 'disponible' | 'ocupada' | 'por_cobrar' | 'fuera_servicio'

const TABLES: { number: number; state: TableState; total?: number; since?: string }[] = [
  { number: 1, state: 'ocupada', total: 86000, since: 'Hace 1 h 20 min' },
  { number: 2, state: 'disponible' },
  { number: 3, state: 'por_cobrar', total: 142500, since: 'Hace 2 h 5 min' },
  { number: 4, state: 'ocupada', total: 38000, since: 'Hace 25 min' },
  { number: 5, state: 'fuera_servicio' },
]

const TABLE_STYLE: Record<TableState, { label: string; bar: string; text: string }> = {
  disponible: { label: 'Disponible', bar: 'bg-border-strong', text: 'text-muted-foreground' },
  ocupada: { label: 'Ocupada', bar: 'bg-primary', text: 'text-primary-text' },
  por_cobrar: { label: 'Por cobrar', bar: 'bg-warning', text: 'text-warning' },
  fuera_servicio: {
    label: 'Fuera de servicio',
    bar: 'bg-transparent',
    text: 'text-subtle-foreground',
  },
}

const STOCK: { name: string; detail: string; stock: number; min: number; level: StockLevel }[] = [
  { name: 'Cerveza Águila 330 ml', detail: 'Cervezas', stock: 42, min: 24, level: 'ok' },
  {
    name: 'Aguardiente Antioqueño 750 ml',
    detail: 'Aguardientes',
    stock: 7,
    min: 6,
    level: 'cerca',
  },
  { name: 'Agua con gas 600 ml', detail: 'Aguas', stock: 4, min: 6, level: 'minimo' },
  { name: 'Ron Medellín 8 años 750 ml', detail: 'Rones', stock: 0, min: 3, level: 'agotado' },
]

export default function App() {
  const [now] = useState(() => new Date())
  const businessDate = businessDateOf(now)
  const dayLabel = formatBusinessDateLong(businessDate)

  const cost = 3000
  const price = roundUpToStep(cost + applyBp(cost, 5000), 100)
  const margin = ratioToBp(price - cost, price) ?? 0

  const occupied = TABLES.filter((t) => t.state === 'ocupada' || t.state === 'por_cobrar').length
  const active = TABLES.filter((t) => t.state !== 'fuera_servicio').length

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-10 px-4 pt-8 pb-16 sm:px-8 sm:pt-12">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <p className="text-label text-muted-foreground first-letter:uppercase">
            Jornada del {dayLabel}
          </p>
          <h1 className="mt-1 text-display font-semibold tracking-tight">Kmilo Bar</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 items-center gap-2 rounded-full bg-success/12 px-3.5 text-label font-medium text-success">
            <span aria-hidden className="size-2 rounded-full bg-success" />
            Caja abierta
          </span>
          <span className="tabular text-meta text-subtle-foreground">{formatTime(now)}</span>
        </div>
      </header>

      {/* Resumen: una sola banda con divisores, no tarjetas sueltas */}
      <section aria-labelledby="resumen" className="flex flex-col gap-4">
        <h2 id="resumen" className="text-title font-semibold">
          Resumen de la jornada
        </h2>
        <dl className="grid divide-border rounded-xl border bg-card max-sm:divide-y sm:grid-cols-3 sm:divide-x">
          <Figure label="Ventas" value={formatCop(266500)} note="4 cuentas cerradas" />
          <Figure label="Cobrado" value={formatCop(224000)} note="Efectivo y transferencias" />
          <Figure
            label="Mesas ocupadas"
            value={`${occupied} de ${active}`}
            note="1 cuenta por cobrar"
          />
        </dl>
      </section>

      {/* Mesas: el elemento protagonista */}
      <section aria-labelledby="mesas" className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="mesas" className="text-title font-semibold">
            Mesas
          </h2>
          <Button variant="secondary" size="sm">
            <ShoppingBag aria-hidden />
            Venta en barra
          </Button>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {TABLES.map((t) => {
            const style = TABLE_STYLE[t.state]
            const off = t.state === 'fuera_servicio'
            return (
              <li key={t.number}>
                <button
                  type="button"
                  disabled={off}
                  className={cn(
                    'relative flex h-full min-h-36 w-full flex-col overflow-hidden rounded-xl border bg-card p-4 pl-5 text-left transition-colors',
                    off
                      ? 'cursor-not-allowed border-dashed'
                      : 'cursor-pointer hover:border-border-strong hover:bg-raised',
                  )}
                >
                  <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', style.bar)} />
                  <span className="text-label text-muted-foreground">Mesa</span>
                  <span
                    className={cn(
                      'tabular text-[2.75rem] leading-none font-semibold tracking-tight',
                      off && 'text-subtle-foreground',
                    )}
                  >
                    {t.number}
                  </span>
                  <span className="mt-auto flex flex-col gap-0.5 pt-4">
                    <span className={cn('text-label font-medium', style.text)}>{style.label}</span>
                    {t.total !== undefined ? (
                      <>
                        <span className="tabular text-base font-semibold">
                          {formatCop(t.total)}
                        </span>
                        <span className="text-meta text-subtle-foreground">{t.since}</span>
                      </>
                    ) : (
                      <span className="text-meta text-subtle-foreground">
                        {off ? 'No disponible' : 'Toca para abrir cuenta'}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        {/* Inventario con semáforo */}
        <section aria-labelledby="inventario" className="flex flex-col gap-4">
          <h2 id="inventario" className="text-title font-semibold">
            Inventario por revisar
          </h2>
          <ul className="divide-y divide-border rounded-xl border bg-card">
            {STOCK.map((p) => (
              <li
                key={p.name}
                className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-3.5"
              >
                <div className="min-w-0">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-meta text-subtle-foreground">
                    {p.detail}, mínimo {p.min}
                  </p>
                </div>
                <div className="flex items-center gap-5">
                  <span className="tabular text-lg font-semibold">{p.stock}</span>
                  <StockIndicator level={p.level} className="w-40" />
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Precio sugerido: reglas de dominio aplicadas */}
        <section aria-labelledby="precio" className="flex flex-col gap-4">
          <h2 id="precio" className="text-title font-semibold">
            Precio sugerido
          </h2>
          <div className="flex flex-col gap-5 rounded-xl border bg-card p-5">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Pair label="Costo" value={formatCop(cost)} />
              <Pair label="Recargo" value="50 %" />
              <Pair label="Precio de venta" value={formatCop(price)} strong />
              <Pair label="Margen bruto" value={formatBp(margin)} strong />
            </dl>
            <p className="text-meta text-subtle-foreground">
              Redondeado hacia arriba al múltiplo de $ 100.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button>
                <Plus aria-hidden />
                Abrir cuenta
              </Button>
              <Button variant="outline">
                <ReceiptText aria-hidden />
                Registrar gasto
              </Button>
              <Button variant="destructive">Anular</Button>
            </div>
          </div>
        </section>
      </div>

      <p className="text-meta text-subtle-foreground">
        Vista previa del sistema de diseño con datos de ejemplo.
      </p>
    </div>
  )
}

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-4 sm:py-5">
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className="tabular text-figure font-semibold tracking-tight">{value}</dd>
      <dd className="text-meta text-subtle-foreground">{note}</dd>
    </div>
  )
}

function Pair({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className={cn('tabular text-lg', strong ? 'font-semibold' : 'text-foreground/90')}>
        {value}
      </dd>
    </div>
  )
}
