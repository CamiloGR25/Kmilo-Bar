import { useState } from 'react'
import { ArrowLeftRight, Loader2, Pencil } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { Page, PageHeader } from '@/components/shared/page-header'
import { StockIndicator } from '@/components/shared/stock-indicator'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/domain/dates'
import { formatCop } from '@/domain/money'
import { useProducts } from '@/features/products/services/catalog-service'
import { useSettings } from '@/features/settings/services/settings-service'
import { cn } from '@/lib/utils'
import { MOVEMENT_LABELS } from '../domain/movements'
import { stockLevel } from '../domain/stock'
import { useProductMovements } from '../services/inventory-service'
import { PurchasePrices } from '@/features/purchases/components/purchase-prices'
import { MovementDialog } from './movement-dialog'

/** Kardex: historial de movimientos de un producto (R-INV-01, el stock es su suma). */
export function KardexPage() {
  const { id } = useParams()
  const products = useProducts()
  const settings = useSettings()
  const movements = useProductMovements(id)
  const [open, setOpen] = useState(false)
  const product = products.data?.find((p) => p.id === id)

  if (products.loading || settings.loading) {
    return (
      <Page>
        <p className="inline-flex items-center gap-2 text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Cargando…
        </p>
      </Page>
    )
  }
  if (!product) {
    return (
      <Page>
        <PageHeader
          title="Producto no encontrado"
          back={{ to: '/inventario', label: 'Inventario' }}
        />
      </Page>
    )
  }

  const near = settings.data?.settings.nearMinFactorBp ?? 15000
  return (
    <Page>
      <PageHeader
        title={product.name}
        back={{ to: '/inventario', label: 'Inventario' }}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={`/productos/${product.id}`}>
                <Pencil aria-hidden />
                Editar producto
              </Link>
            </Button>
            <Button onClick={() => setOpen(true)}>
              <ArrowLeftRight aria-hidden />
              Registrar movimiento
            </Button>
          </>
        }
      />

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
        <Stat label="Stock" value={String(product.stock)}>
          <StockIndicator
            level={stockLevel(product.stock, product.minStock, near)}
            className="text-meta"
          />
        </Stat>
        <Stat label="Mínimo" value={String(product.minStock)} />
        <Stat label="Costo promedio" value={formatCop(product.avgCost)}>
          <span className="text-meta text-subtle-foreground">
            Total a costo {formatCop(product.stock * product.avgCost)}
          </span>
        </Stat>
        <Stat label="Precio de venta" value={formatCop(product.salePrice)}>
          <span className="text-meta text-subtle-foreground">
            Total a la venta {formatCop(product.stock * product.salePrice)}
          </span>
        </Stat>
      </dl>

      <PurchasePrices movements={movements.data ?? []} />

      <section className="flex flex-col gap-4">
        <h2 className="text-title font-semibold">Movimientos</h2>
        <div className="rounded-xl border bg-card">
          {movements.loading && <p className="px-5 py-4 text-muted-foreground">Cargando…</p>}
          {movements.error && (
            <p className="px-5 py-4 text-destructive">{movements.error.message}</p>
          )}
          {!movements.loading && (movements.data ?? []).length === 0 && (
            <p className="px-5 py-4 text-muted-foreground">
              Aún no hay movimientos. Registra el inventario inicial para empezar.
            </p>
          )}
          <ul className="divide-y divide-border">
            {(movements.data ?? []).map((m) => (
              <li
                key={m.id}
                className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-1 px-5 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium">{MOVEMENT_LABELS[m.type] ?? m.type}</p>
                  <p className="text-meta text-subtle-foreground">
                    {m.createdAt ? formatDateTime(m.createdAt) : 'Guardando…'}
                    {m.reason ? `, ${m.reason}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={cn(
                      'tabular font-semibold',
                      m.qty > 0 ? 'text-success' : 'text-destructive',
                    )}
                  >
                    {m.qty > 0 ? `+${m.qty}` : `−${Math.abs(m.qty)}`}
                  </p>
                  <p className="tabular text-meta text-subtle-foreground">
                    Queda {m.stockAfter}, {formatCop(m.unitCost)} c/u
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <MovementDialog product={product} open={open} onOpenChange={setOpen} />
    </Page>
  )
}

function Stat({
  label,
  value,
  children,
}: {
  label: string
  value: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-card px-5 py-4">
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className="tabular text-figure font-semibold tracking-tight">{value}</dd>
      {children && <dd>{children}</dd>}
    </div>
  )
}
