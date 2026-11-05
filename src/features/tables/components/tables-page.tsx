import { useMemo, useState } from 'react'
import { Loader2, Settings2, ShoppingBag } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { formatCop } from '@/domain/money'
import { useAuth } from '@/features/auth/use-auth'
import CashStatus, { CashRequiredNotice } from '@/features/cash/components/cash-status'
import { useOpenCashSession } from '@/features/cash/services/cash-service'
import { formatElapsed, OrderError, type Order } from '@/features/orders/domain/orders'
import { newId, openOrder, useOpenOrders } from '@/features/orders/services/orders-service'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'
import { TABLE_STATUS_LABELS, type Table, type TableStatus } from '../domain/tables'
import { useTables } from '../services/tables-service'
import { ManageTablesDialog } from './manage-tables-dialog'

const TABLE_STYLE: Record<TableStatus, { bar: string; text: string }> = {
  disponible: { bar: 'bg-border-strong', text: 'text-muted-foreground' },
  ocupada: { bar: 'bg-primary', text: 'text-primary-text' },
  por_cobrar: { bar: 'bg-warning', text: 'text-warning' },
  fuera_servicio: { bar: 'bg-transparent', text: 'text-subtle-foreground' },
}

/** Mesas: pantalla inicial durante la jornada (DESIGN_SYSTEM §8.2). */
export function TablesPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const tables = useTables()
  const orders = useOpenOrders()
  const cash = useOpenCashSession()
  const now = useNow()
  const [managing, setManaging] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)

  const ordersById = useMemo(
    () => new Map((orders.data ?? []).map((o) => [o.id, o])),
    [orders.data],
  )
  const active = (tables.data ?? []).filter((t) => t.active)
  const barOrders = (orders.data ?? []).filter((o) => o.type === 'barra')
  const cashOpen = !!cash.data

  async function onTable(t: Table) {
    if (t.currentOrderId) {
      navigate(`/cuentas/${t.currentOrderId}`)
      return
    }
    if (!cashOpen) {
      toast.error('Abre la caja antes de abrir una cuenta.')
      return
    }
    const orderId = newId()
    setOpening(t.id)
    try {
      await openOrder(user?.uid ?? '', orderId, { type: 'mesa', tableId: t.id })
      navigate(`/cuentas/${orderId}`)
    } catch (e) {
      toast.error(e instanceof OrderError ? e.message : `No se pudo abrir: ${(e as Error).message}`)
    } finally {
      setOpening(null)
    }
  }

  return (
    <Page wide>
      <PageHeader
        title="Mesas"
        description={<CashStatus className="mt-1" />}
        actions={
          <>
            <Button variant="outline" onClick={() => setManaging(true)}>
              <Settings2 aria-hidden />
              Administrar mesas
            </Button>
            <Button asChild variant="secondary">
              <Link to="/barra">
                <ShoppingBag aria-hidden />
                Venta en barra
                {barOrders.length > 0 && (
                  <span className="rounded-full bg-primary px-2 tabular text-meta text-primary-foreground">
                    {barOrders.length}
                  </span>
                )}
              </Link>
            </Button>
          </>
        }
      />

      {!cash.loading && !cashOpen && <CashRequiredNotice />}

      {tables.error || orders.error ? (
        <p role="alert" className="text-label text-destructive">
          No se pudieron cargar las mesas: {(tables.error ?? orders.error)?.message}
        </p>
      ) : tables.loading ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="h-36 animate-pulse rounded-xl bg-card" />
          ))}
        </ul>
      ) : active.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-6 text-label text-muted-foreground">
          No hay mesas activas. Créalas en “Administrar mesas”.
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {active.map((t) => (
            <li key={t.id}>
              <TableCard
                table={t}
                order={t.currentOrderId ? ordersById.get(t.currentOrderId) : undefined}
                now={now}
                busy={opening === t.id}
                disabled={opening !== null || (t.status === 'disponible' && !cashOpen)}
                onClick={() => onTable(t)}
              />
            </li>
          ))}
        </ul>
      )}

      <ManageTablesDialog open={managing} onOpenChange={setManaging} tables={tables.data ?? []} />
    </Page>
  )
}

function TableCard({
  table,
  order,
  now,
  busy,
  disabled,
  onClick,
}: {
  table: Table
  order: Order | undefined
  now: Date
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  const style = TABLE_STYLE[table.status]
  const off = table.status === 'fuera_servicio'
  const showNumberOnly = table.name === `Mesa ${table.number}`
  return (
    <button
      type="button"
      disabled={off || disabled}
      onClick={onClick}
      aria-label={`${showNumberOnly ? table.name : `${table.name} (mesa ${table.number})`}, ${TABLE_STATUS_LABELS[table.status].toLowerCase()}${order ? `, ${formatCop(order.total)}` : ''}`}
      className={cn(
        'relative flex h-full min-h-36 w-full flex-col overflow-hidden rounded-xl border bg-card p-4 pl-5 text-left transition-colors',
        off
          ? 'cursor-not-allowed border-dashed'
          : 'cursor-pointer hover:border-border-strong hover:bg-raised disabled:cursor-not-allowed disabled:opacity-60',
      )}
    >
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', style.bar)} />
      <span className="text-label text-muted-foreground">
        {showNumberOnly ? 'Mesa' : table.name}
      </span>
      <span
        className={cn(
          'tabular text-[2.75rem] leading-none font-semibold tracking-tight',
          off && 'text-subtle-foreground',
        )}
      >
        {table.number}
      </span>
      <span className="mt-auto flex flex-col gap-0.5 pt-4">
        <span className={cn('text-label font-medium', style.text)}>
          {TABLE_STATUS_LABELS[table.status]}
        </span>
        {busy ? (
          <span className="inline-flex items-center gap-2 text-meta text-subtle-foreground">
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
            Abriendo cuenta…
          </span>
        ) : order ? (
          <>
            <span className="tabular text-base font-semibold">{formatCop(order.total)}</span>
            <span className="text-meta text-subtle-foreground">
              {order.openedAt ? formatElapsed(order.openedAt, now) : 'Recién abierta'}
            </span>
          </>
        ) : (
          <span className="text-meta text-subtle-foreground">
            {off ? 'No disponible' : 'Toca para abrir cuenta'}
          </span>
        )}
      </span>
    </button>
  )
}
