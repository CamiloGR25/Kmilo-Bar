import { useState } from 'react'
import { Ban, ClipboardCheck, Loader2, PackageCheck, Pencil, Send, Wallet } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { BUSINESS_NAME } from '@/components/shared/brand'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Page, PageHeader } from '@/components/shared/page-header'
import { ShareTextDialog } from '@/components/shared/share-text-dialog'
import { Button } from '@/components/ui/button'
import { formatBusinessDateLong, formatDateTime } from '@/domain/dates'
import { formatCop } from '@/domain/money'
import { useAuth } from '@/features/auth/use-auth'
import { CHANNEL_LABELS } from '@/features/cash/domain/payments'
import { useProducts } from '@/features/products/services/catalog-service'
import {
  describeQty,
  orderBalance,
  orderText,
  pendingQty,
  purchaseUnitOf,
  RECEIVABLE,
} from '../domain/purchases'
import {
  cancelPurchaseOrder,
  closeShort,
  markRequested,
  usePurchaseOrder,
  useSupplierPaymentsOfOrder,
} from '../services/purchases-service'
import { ReceiveDialog, SupplierPaymentDialog } from './purchase-dialogs'
import { PaymentStatusText, PurchaseStatusBadge } from './status'

/** Detalle de un pedido o compra (F7-02…04): enviar, recibir, cerrar, cancelar y pagar. */
export function PurchasePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { user } = useAuth()
  const uid = user?.uid ?? ''
  const order = usePurchaseOrder(id)
  const products = useProducts()
  const payments = useSupplierPaymentsOfOrder(id)
  const [sending, setSending] = useState(false)
  const [receiving, setReceiving] = useState(false)
  // Compra directa recién registrada (`?pagar=1`): preguntar por el pago (D-223 #3).
  const [paying, setPaying] = useState<'normal' | 'tras_recibir' | null>(() =>
    params.get('pagar') === '1' ? 'tras_recibir' : null,
  )
  const [cancelling, setCancelling] = useState(false)
  const [closing, setClosing] = useState(false)

  const o = order.data

  if (order.loading) {
    return (
      <Page>
        <p className="inline-flex items-center gap-2 text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Cargando…
        </p>
      </Page>
    )
  }
  if (!o) {
    return (
      <Page>
        <PageHeader title="Compra" back={{ to: '/compras', label: 'Compras' }} />
        <p className="text-destructive">No se encontró el pedido.</p>
      </Page>
    )
  }

  const byId = new Map((products.data ?? []).map((p) => [p.id, p]))
  const unitOf = (productId: string) => {
    const p = byId.get(productId)
    return p ? purchaseUnitOf(p) : null
  }
  const receivable = RECEIVABLE.includes(o.status) && !o.shortClosed
  const balance = orderBalance(o)
  const pendingUnits = o.lines.reduce((s, l) => s + pendingQty(l), 0)

  return (
    <Page>
      <PageHeader
        title={`${o.kind === 'directa' ? 'Compra' : 'Pedido'} #${o.number}`}
        description={
          <>
            <Link to={`/proveedores/${o.supplierId}`} className="text-primary-text hover:underline">
              {o.supplierName}
            </Link>
            {o.createdAt && `, ${formatDateTime(o.createdAt)}`}
          </>
        }
        back={{ to: '/compras', label: 'Compras' }}
        actions={
          <>
            {o.status === 'borrador' && (
              <>
                <Button variant="outline" asChild>
                  <Link to={`/compras/${o.id}/editar`}>
                    <Pencil aria-hidden />
                    Editar
                  </Link>
                </Button>
                <Button variant="outline" onClick={() => setSending(true)}>
                  <Send aria-hidden />
                  Enviar al proveedor
                </Button>
                <Button
                  onClick={() =>
                    markRequested(uid, o.id)
                      .then(() => {
                        toast.success(`Pedido #${o.number} registrado`)
                        navigate('/compras')
                      })
                      .catch((e: Error) => toast.error(e.message))
                  }
                >
                  <ClipboardCheck aria-hidden />
                  Registrar pedido
                </Button>
              </>
            )}
            {receivable && (
              <Button onClick={() => setReceiving(true)}>
                <PackageCheck aria-hidden />
                Recibir mercancía
              </Button>
            )}
            {balance > 0 && (
              <Button
                variant={receivable ? 'outline' : 'default'}
                onClick={() => setPaying('normal')}
              >
                <Wallet aria-hidden />
                Pagar
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <PurchaseStatusBadge order={o} />
        <PaymentStatusText order={o} />
        {o.expectedDate && receivable && (
          <span className="text-label text-muted-foreground">
            Entrega esperada: {formatBusinessDateLong(o.expectedDate)}
          </span>
        )}
      </div>

      <dl className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3">
        <div className="flex flex-col gap-1 bg-card px-5 py-4">
          <dt className="text-label text-muted-foreground">Pedido (estimado)</dt>
          <dd className="tabular text-xl font-semibold">{formatCop(o.estTotal)}</dd>
        </div>
        <div className="flex flex-col gap-1 bg-card px-5 py-4">
          <dt className="text-label text-muted-foreground">Recibido (costo real)</dt>
          <dd className="tabular text-xl font-semibold">{formatCop(o.receivedTotal)}</dd>
          {receivable && pendingUnits > 0 && o.receivedTotal > 0 && (
            <dd className="text-meta text-warning">Faltan {pendingUnits} unidades</dd>
          )}
        </div>
        <div className="flex flex-col gap-1 bg-card px-5 py-4">
          <dt className="text-label text-muted-foreground">Pagado</dt>
          <dd className="tabular text-xl font-semibold">{formatCop(o.paidTotal)}</dd>
          {balance > 0 && <dd className="text-meta text-warning">Debes {formatCop(balance)}</dd>}
        </div>
      </dl>

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">Productos</h2>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[36rem] text-label">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th scope="col" className="px-4 py-3 text-left font-medium">
                  Producto
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Pedido
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Recibido
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Pendiente
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Costo pedido
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {o.lines.map((l) => {
                const pend = o.shortClosed || o.status === 'cancelado' ? 0 : pendingQty(l)
                return (
                  <tr key={l.lineId}>
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{l.nameSnap}</span>
                      <span className="block text-meta text-subtle-foreground">
                        {describeQty(l.qtyOrdered, unitOf(l.productId))}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular">{l.qtyOrdered}</td>
                    <td className="px-4 py-2.5 text-right tabular">{l.qtyReceived}</td>
                    <td
                      className={`px-4 py-2.5 text-right tabular ${pend > 0 ? 'text-warning' : ''}`}
                    >
                      {pend}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular">{formatCop(l.estUnitCost)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {o.notes && <p className="text-label text-muted-foreground">Notas: {o.notes}</p>}
      </section>

      {(payments.data ?? []).length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-title font-semibold">Pagos</h2>
          <ul className="divide-y divide-border rounded-xl border bg-card">
            {payments.data!.map((p) => (
              <li key={p.id} className="flex justify-between gap-4 px-4 py-3 text-label">
                <span>
                  {p.method === 'efectivo' ? 'Efectivo' : CHANNEL_LABELS[p.channel ?? 'otro']}
                  {p.fromCash ? ', de la caja' : ', por fuera'}
                  <span className="block text-meta text-subtle-foreground">
                    {p.createdAt ? formatDateTime(p.createdAt) : ''}
                  </span>
                </span>
                <span className="tabular font-medium">{formatCop(p.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {o.status === 'parcial' && !o.shortClosed && (
          <Button variant="outline" onClick={() => setClosing(true)}>
            Cerrar con faltante
          </Button>
        )}
        {(o.status === 'borrador' || o.status === 'solicitado') && o.receivedTotal === 0 && (
          <Button variant="outline" onClick={() => setCancelling(true)}>
            <Ban aria-hidden />
            Cancelar pedido
          </Button>
        )}
        {o.status === 'solicitado' && (
          <Button variant="ghost" onClick={() => setSending(true)}>
            Volver a enviar al proveedor
          </Button>
        )}
      </div>

      <ShareTextDialog
        title="Enviar el pedido"
        description={
          o.status === 'borrador'
            ? 'Al enviarlo o copiarlo, el pedido queda registrado (solicitado).'
            : 'Texto del pedido para el proveedor.'
        }
        text={orderText(BUSINESS_NAME, o, unitOf)}
        open={sending}
        onOpenChange={setSending}
        onShared={() => {
          if (o.status !== 'borrador') return
          markRequested(uid, o.id)
            .then(() => toast.success('Pedido enviado: queda como solicitado'))
            .catch((e: Error) => toast.error(e.message))
        }}
      />
      <ReceiveDialog
        order={o}
        products={products.data ?? []}
        open={receiving}
        onOpenChange={setReceiving}
        onReceived={() => setPaying('tras_recibir')}
      />
      {paying && balance > 0 && (
        <SupplierPaymentDialog
          order={o}
          open
          afterReception={paying === 'tras_recibir'}
          onOpenChange={(open) => {
            if (open) return
            // Tras recibir (o una compra directa), al pagar o dejarlo debiendo se vuelve a Compras.
            if (paying === 'tras_recibir') {
              navigate('/compras')
              return
            }
            setPaying(null)
            if (params.has('pagar')) setParams({}, { replace: true })
          }}
        />
      )}
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title="Cancelar el pedido"
        destructive
        requireReason
        confirmLabel="Cancelar pedido"
        description="El pedido queda cancelado y no se puede recibir. No cambia el inventario."
        onConfirm={async (reason) => {
          try {
            await cancelPurchaseOrder(uid, o.id, reason ?? '')
            toast.success('Pedido cancelado')
            navigate('/compras')
          } catch (e) {
            toast.error((e as Error).message)
          }
        }}
      />
      <ConfirmDialog
        open={closing}
        onOpenChange={setClosing}
        title="Cerrar con faltante"
        requireReason
        confirmLabel="Cerrar pedido"
        description={`Las ${pendingUnits} unidades pendientes ya no llegan. El pedido queda cerrado con lo que se recibió.`}
        onConfirm={async (reason) => {
          try {
            await closeShort(uid, o.id, reason ?? '')
            toast.success('Pedido cerrado con faltante')
          } catch (e) {
            toast.error((e as Error).message)
          }
        }}
      />
    </Page>
  )
}
