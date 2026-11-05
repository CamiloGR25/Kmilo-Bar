import { cn } from '@/lib/utils'
import { countAlerts, useInventory } from '../hooks/use-inventory'

/**
 * Insignia del menú con los productos en alerta (agotados + en mínimo), R-INV-09.
 * Se carga de forma diferida para no traer Firestore al iniciar sesión.
 */
export default function InventoryBadge({ className }: { className?: string }) {
  const { items } = useInventory()
  const n = countAlerts(items)
  if (n === 0) return null
  return (
    <span
      aria-label={`${n} productos en alerta de stock`}
      className={cn(
        'inline-grid h-5 min-w-5 place-items-center rounded-full bg-[#dc2626] px-1.5 tabular text-[0.6875rem] leading-none font-semibold text-white',
        className,
      )}
    >
      {n > 99 ? '99+' : n}
    </span>
  )
}
