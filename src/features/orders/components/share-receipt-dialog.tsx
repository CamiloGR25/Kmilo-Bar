import { Copy, MessageCircle, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { BUSINESS_NAME } from '@/components/shared/brand'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Resumen copiado')
    } catch {
      toast.error('No se pudo copiar. Selecciona el texto y cópialo.')
    }
  }

  async function share() {
    try {
      await navigator.share({ text })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error('No se pudo compartir.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-title">Resumen para el cliente</DialogTitle>
          <DialogDescription className="text-label">
            Envíalo por WhatsApp o cópialo. No incluye desglose de impuestos.
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-[50dvh] overflow-y-auto rounded-lg bg-raised px-4 py-3 font-sans text-label whitespace-pre-wrap">
          {text}
        </pre>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={copy}>
            <Copy aria-hidden />
            Copiar
          </Button>
          <div className="flex gap-2 max-sm:flex-col">
            {canShare && (
              <Button variant="outline" onClick={share}>
                <Share2 aria-hidden />
                Compartir
              </Button>
            )}
            <Button asChild>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(text)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle aria-hidden />
                WhatsApp
              </a>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
