import { cn } from '@/lib/utils'
import {
  PAYMENT_STATUS_LABELS,
  PURCHASE_STATUS_LABELS,
  type PaymentStatus,
  type PurchaseOrder,
} from '../domain/purchases'

const STATUS_TONE: Record<PurchaseOrder['status'], string> = {
  borrador: 'bg-raised text-muted-foreground',
  solicitado: 'bg-primary/15 text-primary-text',
  parcial: 'bg-warning/15 text-warning',
  recibido: 'bg-success/15 text-success',
  cancelado: 'bg-raised text-subtle-foreground',
}

const PAY_TONE: Record<PaymentStatus, string> = {
  pendiente: 'text-warning',
  abonado: 'text-warning',
  pagado: 'text-success',
}

/** Estado del pedido (R-COM-01) como etiqueta con texto. */
export function PurchaseStatusBadge({
  order,
}: {
  order: Pick<PurchaseOrder, 'status' | 'shortClosed'>
}) {
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center rounded-full px-2.5 text-meta font-medium',
        STATUS_TONE[order.status],
      )}
    >
      {order.shortClosed ? 'Cerrado con faltante' : PURCHASE_STATUS_LABELS[order.status]}
    </span>
  )
}

/** Estado del pago (R-COM-05); no aplica si aún no se recibe nada. */
export function PaymentStatusText({
  order,
}: {
  order: Pick<PurchaseOrder, 'paymentStatus' | 'receivedTotal'>
}) {
  if (order.receivedTotal === 0) return null
  return (
    <span className={cn('text-meta font-medium', PAY_TONE[order.paymentStatus])}>
      {PAYMENT_STATUS_LABELS[order.paymentStatus]}
    </span>
  )
}
