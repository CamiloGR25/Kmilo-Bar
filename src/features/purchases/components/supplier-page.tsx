import { useMemo, useState } from 'react'
import { Loader2, MessageCircle, Pencil, Plus } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Page, PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/domain/dates'
import { formatCop } from '@/domain/money'
import { useAuth } from '@/features/auth/use-auth'
import { useProducts } from '@/features/products/services/catalog-service'
import { orderBalance, supplierTotals } from '../domain/purchases'
import { setSupplierActive, usePurchaseOrders, useSuppliers } from '../services/purchases-service'
import { PaymentStatusText, PurchaseStatusBadge } from './status'
import { SupplierDialog } from './suppliers-page'

/** Detalle de un proveedor (F7-01): contacto, saldo, pedidos y últimos costos. */
export function SupplierPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const suppliers = useSuppliers()
  const orders = usePurchaseOrders()
  const products = useProducts()
  const [editing, setEditing] = useState(false)
  const [toggling, setToggling] = useState(false)

  const supplier = suppliers.data?.find((s) => s.id === id)
  const mine = useMemo(
    () => (orders.data ?? []).filter((o) => o.supplierId === id),
    [orders.data, id],
  )
  const t = supplierTotals(mine).get(id ?? '') ?? { debt: 0, bought: 0, open: 0 }
  const usual = (products.data ?? []).filter((p) => p.supplierId === id && p.active)
  const productName = new Map((products.data ?? []).map((p) => [p.id, p.name]))
  const costs = Object.entries(supplier?.lastCosts ?? {}).sort((a, b) =>
    (productName.get(a[0]) ?? '').localeCompare(productName.get(b[0]) ?? '', 'es'),
  )
  const phoneDigits = supplier?.phone.replace(/\D/g, '') ?? ''

  if (suppliers.loading) {
    return (
      <Page>
        <p className="inline-flex items-center gap-2 text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Cargando…
        </p>
      </Page>
    )
  }
  if (!supplier) {
    return (
      <Page>
        <PageHeader title="Proveedor" back={{ to: '/proveedores', label: 'Proveedores' }} />
        <p className="text-destructive">No se encontró el proveedor.</p>
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader
        title={supplier.name}
        description={
          [supplier.contactName, supplier.phone].filter(Boolean).join(', ') || 'Sin contacto'
        }
        back={{ to: '/proveedores', label: 'Proveedores' }}
        actions={
          <>
            {phoneDigits.length >= 7 && (
              <Button variant="outline" asChild>
                <a
                  href={`https://wa.me/${phoneDigits.length === 10 ? `57${phoneDigits}` : phoneDigits}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle aria-hidden />
                  WhatsApp
                </a>
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil aria-hidden />
              Editar
            </Button>
            <Button asChild>
              <Link to={`/compras/nuevo?proveedor=${supplier.id}`}>
                <Plus aria-hidden />
                Nuevo pedido
              </Link>
            </Button>
          </>
        }
      />

      <dl className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3">
        <div className="flex flex-col gap-1 bg-card px-5 py-4">
          <dt className="text-label text-muted-foreground">Le debes</dt>
          <dd className={`tabular text-figure font-semibold ${t.debt > 0 ? 'text-warning' : ''}`}>
            {formatCop(t.debt)}
          </dd>
        </div>
        <div className="flex flex-col gap-1 bg-card px-5 py-4">
          <dt className="text-label text-muted-foreground">Total comprado</dt>
          <dd className="tabular text-figure font-semibold">{formatCop(t.bought)}</dd>
        </div>
        <div className="flex flex-col gap-1 bg-card px-5 py-4">
          <dt className="text-label text-muted-foreground">Pedidos por llegar</dt>
          <dd className="tabular text-figure font-semibold">{t.open}</dd>
        </div>
      </dl>

      {supplier.notes && (
        <p className="rounded-xl border bg-card px-5 py-4 text-label text-muted-foreground">
          {supplier.notes}
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">Pedidos y compras</h2>
        {mine.length === 0 ? (
          <p className="text-label text-muted-foreground">
            Todavía no hay compras a este proveedor.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border bg-card">
            {mine.map((o) => (
              <li key={o.id}>
                <Link
                  to={`/compras/${o.id}`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-raised sm:px-5"
                >
                  <div>
                    <p className="font-medium">
                      {o.kind === 'directa' ? 'Compra' : 'Pedido'} #{o.number}
                    </p>
                    <p className="text-meta text-subtle-foreground">
                      {o.createdAt ? formatDate(o.createdAt) : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <PurchaseStatusBadge order={o} />
                    <span className="text-right">
                      <span className="block tabular font-medium">
                        {formatCop(o.receivedTotal || o.estTotal)}
                      </span>
                      {orderBalance(o) > 0 ? (
                        <span className="text-meta text-warning">
                          Debes {formatCop(orderBalance(o))}
                        </span>
                      ) : (
                        <PaymentStatusText order={o} />
                      )}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <h2 className="text-title font-semibold">Productos habituales</h2>
          {usual.length === 0 ? (
            <p className="text-label text-muted-foreground">
              Ningún producto tiene a este proveedor como habitual. Se asigna en cada producto.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {usual.map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/productos/${p.id}`}
                    className="inline-flex h-9 items-center rounded-full border px-3 text-label hover:bg-raised"
                  >
                    {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-title font-semibold">Últimos costos</h2>
          {costs.length === 0 ? (
            <p className="text-label text-muted-foreground">Aparecen al recibir mercancía.</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border bg-card">
              {costs.map(([pid, cost]) => (
                <li key={pid} className="flex justify-between gap-4 px-4 py-2.5 text-label">
                  <span>{productName.get(pid) ?? 'Producto eliminado'}</span>
                  <span className="tabular font-medium">{formatCop(cost)} c/u</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div>
        <Button variant="outline" onClick={() => setToggling(true)}>
          {supplier.active ? 'Desactivar proveedor' : 'Activar proveedor'}
        </Button>
      </div>

      <SupplierDialog
        open={editing}
        onOpenChange={setEditing}
        supplier={supplier}
        allSuppliers={suppliers.data ?? []}
      />
      <ConfirmDialog
        open={toggling}
        onOpenChange={setToggling}
        title={supplier.active ? 'Desactivar proveedor' : 'Activar proveedor'}
        confirmLabel={supplier.active ? 'Desactivar' : 'Activar'}
        description={
          supplier.active
            ? 'No aparecerá al crear pedidos. Su historial y lo que le debes se conservan.'
            : 'Volverá a aparecer al crear pedidos.'
        }
        onConfirm={async () => {
          try {
            await setSupplierActive(user?.uid ?? '', supplier, !supplier.active)
            toast.success(supplier.active ? 'Proveedor desactivado' : 'Proveedor activado')
          } catch (e) {
            toast.error((e as Error).message)
          }
        }}
      />
    </Page>
  )
}
