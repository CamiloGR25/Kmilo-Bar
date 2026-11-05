import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { NativeSelect } from '@/components/shared/inputs'
import { Page, PageHeader } from '@/components/shared/page-header'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { businessDateOf, formatBusinessDateLong, formatTime } from '@/domain/dates'
import { formatCop } from '@/domain/money'
import { cn } from '@/lib/utils'
import {
  ORDER_STATUS_LABELS,
  orderLossValue,
  orderTitle,
  type OrderStatus,
  type OrderType,
} from '../domain/orders'
import { useOrdersOfDay } from '../services/orders-service'

const STATUS_TONE: Partial<Record<OrderStatus, string>> = {
  abierta: 'text-primary-text',
  por_cobrar: 'text-warning',
  pagada: 'text-success',
  anulada: 'text-destructive',
}

/** Historial de cuentas por jornada (F4-07), con las pagadas de la Fase 5. */
export function OrdersHistoryPage() {
  const [today] = useState(() => businessDateOf(new Date()))
  const [date, setDate] = useState(today)
  const [status, setStatus] = useState<OrderStatus | ''>('')
  const [type, setType] = useState<OrderType | ''>('')
  const orders = useOrdersOfDay(date)

  const list = useMemo(
    () =>
      (orders.data ?? []).filter(
        (o) => (!status || o.status === status) && (!type || o.type === type),
      ),
    [orders.data, status, type],
  )
  const total = list.reduce((s, o) => s + o.total, 0)
  const losses = list.reduce((s, o) => s + orderLossValue(o.lines), 0)

  return (
    <Page>
      <PageHeader
        title="Cuentas"
        description={
          <span className="first-letter:uppercase">Jornada del {formatBusinessDateLong(date)}</span>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="h-date">Jornada</Label>
          <Input
            id="h-date"
            type="date"
            value={date}
            max={today}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="h-status">Estado</Label>
          <NativeSelect
            id="h-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as OrderStatus | '')}
          >
            <option value="">Todos</option>
            {(['abierta', 'por_cobrar', 'pagada', 'cerrada_sin_consumo'] as const).map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="h-type">Tipo</Label>
          <NativeSelect
            id="h-type"
            value={type}
            onChange={(e) => setType(e.target.value as OrderType | '')}
          >
            <option value="">Mesas y barra</option>
            <option value="mesa">Mesas</option>
            <option value="barra">Barra</option>
          </NativeSelect>
        </div>
      </div>

      {orders.error ? (
        <p role="alert" className="text-label text-destructive">
          No se pudieron cargar las cuentas: {orders.error.message}
        </p>
      ) : orders.loading ? (
        <div className="h-40 animate-pulse rounded-xl bg-card" />
      ) : list.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card p-5 text-label text-muted-foreground">
          No hay cuentas con estos filtros.
        </p>
      ) : (
        <>
          <dl className="grid divide-border rounded-xl border bg-card max-sm:divide-y sm:grid-cols-3 sm:divide-x">
            <Figure label="Cuentas" value={String(list.length)} />
            <Figure label="Consumo" value={formatCop(total)} />
            <Figure label="Servido no cobrado (a costo)" value={formatCop(losses)} />
          </dl>
          <ul className="divide-y divide-border rounded-xl border bg-card">
            {list.map((o) => (
              <li key={o.id}>
                <Link
                  to={`/cuentas/${o.id}`}
                  className="flex min-h-16 items-center gap-4 px-4 py-3 transition-colors hover:bg-raised"
                >
                  <span className="w-12 tabular text-label text-subtle-foreground">
                    #{o.number}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{orderTitle(o)}</p>
                    <p className="text-meta text-subtle-foreground">
                      {o.openedAt ? `Abierta a las ${formatTime(o.openedAt)}` : ''}
                      {o.closedAt ? `, cerrada a las ${formatTime(o.closedAt)}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tabular font-semibold">{formatCop(o.total)}</p>
                    <p
                      className={cn('text-meta', STATUS_TONE[o.status] ?? 'text-muted-foreground')}
                    >
                      {ORDER_STATUS_LABELS[o.status]}
                    </p>
                  </div>
                  <ChevronRight aria-hidden className="size-5 text-subtle-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Page>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-4">
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className="tabular text-title font-semibold">{value}</dd>
    </div>
  )
}
