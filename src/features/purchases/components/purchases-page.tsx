import { useState } from 'react'
import { ChevronRight, ClipboardList, Loader2, PackagePlus, Plus } from 'lucide-react'
import { Link } from 'react-router'
import { Page, PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { formatBusinessDate, formatDate } from '@/domain/dates'
import { formatCop } from '@/domain/money'
import { cn } from '@/lib/utils'
import { orderBalance, pendingQty, type PurchaseOrder } from '../domain/purchases'
import { usePurchaseOrders } from '../services/purchases-service'
import { PaymentStatusText, PurchaseStatusBadge } from './status'

type Filter = 'abiertos' | 'por_pagar' | 'todos'

const FILTERS: { id: Filter; label: string; match: (o: PurchaseOrder) => boolean }[] = [
  {
    id: 'abiertos',
    label: 'Por recibir',
    match: (o) => o.status === 'borrador' || o.status === 'solicitado' || o.status === 'parcial',
  },
  { id: 'por_pagar', label: 'Por pagar', match: (o) => orderBalance(o) > 0 },
  { id: 'todos', label: 'Todos', match: () => true },
]

/** Compras (F7-02): pedidos y compras directas, con lo que falta por llegar y por pagar. */
export function PurchasesPage() {
  const orders = usePurchaseOrders()
  const [filter, setFilter] = useState<Filter>('abiertos')
  const all = orders.data ?? []
  const list = all.filter(FILTERS.find((f) => f.id === filter)!.match)
  const debt = all.reduce((s, o) => s + orderBalance(o), 0)

  return (
    <Page>
      <PageHeader
        title="Compras"
        description={
          debt > 0 ? (
            <>
              Debes a proveedores:{' '}
              <span className="tabular font-semibold text-warning">{formatCop(debt)}</span>
            </>
          ) : (
            'Pedidos a proveedores y mercancía que llega al bar.'
          )
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/compras/nuevo">
                <Plus aria-hidden />
                Nuevo pedido
              </Link>
            </Button>
            <Button asChild>
              <Link to="/compras/nuevo?tipo=directa">
                <PackagePlus aria-hidden />
                Llegó mercancía
              </Link>
            </Button>
          </>
        }
      />

      <div role="group" aria-label="Filtrar compras" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.id}
            variant={f.id === filter ? 'default' : 'outline'}
            aria-pressed={f.id === filter}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            <span className="tabular text-meta opacity-80">{all.filter(f.match).length}</span>
          </Button>
        ))}
      </div>

      {orders.error && (
        <p role="alert" className="text-destructive">
          No se pudieron cargar las compras: {orders.error.message}
        </p>
      )}

      {orders.loading ? (
        <p className="inline-flex items-center gap-2 text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Cargando…
        </p>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
          <ClipboardList aria-hidden className="size-8 text-muted-foreground" />
          <p className="text-muted-foreground">
            {filter === 'abiertos'
              ? 'No hay pedidos por recibir.'
              : filter === 'por_pagar'
                ? 'No le debes nada a ningún proveedor.'
                : 'Todavía no hay compras.'}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border bg-card">
          {list.map((o) => {
            const pendingUnits = o.lines.reduce((s, l) => s + pendingQty(l), 0)
            return (
              <li key={o.id}>
                <Link
                  to={`/compras/${o.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3.5 hover:bg-raised sm:px-5"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {o.supplierName}
                      <span className="font-normal text-muted-foreground">
                        {' '}
                        {o.kind === 'directa' ? 'compra' : 'pedido'} #{o.number}
                      </span>
                    </p>
                    <p className="text-meta text-subtle-foreground">
                      {o.createdAt ? `${formatDate(o.createdAt)}. ` : ''}
                      {o.lines.length} {o.lines.length === 1 ? 'producto' : 'productos'}
                      {(o.status === 'solicitado' || o.status === 'parcial') &&
                        pendingUnits > 0 &&
                        `, faltan ${pendingUnits} unidades`}
                      {o.expectedDate &&
                        o.status !== 'recibido' &&
                        `, llega el ${formatBusinessDate(o.expectedDate)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col items-end gap-1">
                      <PurchaseStatusBadge order={o} />
                      <span
                        className={cn(
                          'tabular text-label',
                          orderBalance(o) > 0 ? 'text-warning' : 'text-muted-foreground',
                        )}
                      >
                        {orderBalance(o) > 0 ? (
                          `Debes ${formatCop(orderBalance(o))}`
                        ) : o.receivedTotal > 0 ? (
                          <PaymentStatusText order={o} />
                        ) : (
                          `Estimado ${formatCop(o.estTotal)}`
                        )}
                      </span>
                    </div>
                    <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Page>
  )
}
