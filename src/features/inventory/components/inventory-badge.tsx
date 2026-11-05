import { cn } from '@/lib/utils'
import { businessDateOf } from '@/domain/dates'
import { useNow } from '@/lib/use-now'
import { reviewStatus } from '../domain/review'
import { countAlerts, useInventory } from '../hooks/use-inventory'
import { useInventoryReview } from '../services/review-service'

/**
 * Insignia del menú con los productos en alerta (agotados + en mínimo), R-INV-09, más la
 * revisión de inventario vencida o del día (R-INV-11).
 * Se carga de forma diferida para no traer Firestore al iniciar sesión.
 */
export default function InventoryBadge({ className }: { className?: string }) {
  const { items } = useInventory()
  const review = useInventoryReview()
  const now = useNow()
  // R-INV-11: la revisión vencida (o la de hoy) también cuenta como alerta.
  const reviewDue =
    review.data && reviewStatus(review.data, businessDateOf(now)).tone === 'danger' ? 1 : 0
  const n = countAlerts(items) + reviewDue
  if (n === 0) return null
  return (
    <span
      aria-label={`${n} alertas de inventario`}
      className={cn(
        'inline-grid h-5 min-w-5 place-items-center rounded-full bg-[#dc2626] px-1.5 tabular text-[0.6875rem] leading-none font-semibold text-white',
        className,
      )}
    >
      {n > 99 ? '99+' : n}
    </span>
  )
}
