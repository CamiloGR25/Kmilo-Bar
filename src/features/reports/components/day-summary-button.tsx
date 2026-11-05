import { useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { BUSINESS_NAME } from '@/components/shared/brand'
import { ShareTextDialog } from '@/components/shared/share-text-dialog'
import { Button } from '@/components/ui/button'
import type { BusinessDate } from '@/domain/dates'
import { aggregate } from '@/domain/metrics/sales-report'
import { useOpenOrders } from '@/features/orders/services/orders-service'
import { daySummaryText } from '../domain/day-summary'
import { useDailyStats } from '../services/daily-stats'

/** Botón "Resumen de la jornada" (D-221) para una jornada ya cerrada o en curso. */
export function DaySummaryButton({ businessDate }: { businessDate: BusinessDate }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" className="w-fit" onClick={() => setOpen(true)}>
        <MessageCircle aria-hidden />
        Resumen de la jornada
      </Button>
      {open && <DaySummaryDialog businessDate={businessDate} onClose={() => setOpen(false)} />}
    </>
  )
}

/** Se suscribe solo mientras está abierto. */
function DaySummaryDialog({
  businessDate,
  onClose,
}: {
  businessDate: BusinessDate
  onClose: () => void
}) {
  const stats = useDailyStats(businessDate)
  const orders = useOpenOrders()
  const open = (orders.data ?? []).filter((o) => o.businessDate === businessDate)
  const text =
    stats.loading || orders.loading
      ? 'Cargando…'
      : daySummaryText(BUSINESS_NAME, businessDate, aggregate(stats.data ? [stats.data] : []), {
          count: open.length,
          total: open.reduce((s, o) => s + o.total, 0),
        })
  return (
    <ShareTextDialog
      title="Resumen de la jornada"
      description="Envíalo por WhatsApp o cópialo."
      text={text}
      open
      onOpenChange={(o) => !o && onClose()}
    />
  )
}
