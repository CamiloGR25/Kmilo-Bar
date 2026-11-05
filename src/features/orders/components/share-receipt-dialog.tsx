import { BUSINESS_NAME } from '@/components/shared/brand'
import { ShareTextDialog } from '@/components/shared/share-text-dialog'
import { formatDateTime } from '@/domain/dates'
import { methodLabel, type Payment } from '@/features/cash/domain/payments'
import { type Order } from '../domain/orders'
import { receiptText } from '../domain/receipt'

/** Resumen de la cuenta para el cliente (D-219): WhatsApp, compartir o copiar. Sin impresora. */
export function ShareReceiptDialog({
  order,
  payments,
  open,
  onOpenChange,
}: {
  order: Order
  payments: readonly Payment[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const when =
    (order.closedAt ?? order.openedAt) ? formatDateTime((order.closedAt ?? order.openedAt)!) : ''
  const text = receiptText(
    BUSINESS_NAME,
    order,
    payments.map((p) => ({ label: methodLabel(p), amount: p.amount })),
    when,
  )
  return (
    <ShareTextDialog
      title="Resumen para el cliente"
      description="Envíalo por WhatsApp o cópialo. No incluye desglose de impuestos."
      text={text}
      open={open}
      onOpenChange={onOpenChange}
    />
  )
}
