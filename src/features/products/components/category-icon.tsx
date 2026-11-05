import { cn } from '@/lib/utils'
import type { CategoryIcon as IconKey } from '../domain/catalog'
import { CATEGORY_ICON_COMPONENTS } from './category-icons'

/** Ícono de categoría en una placa (P-01: reemplaza las fotos de producto). */
export function CategoryIcon({
  icon,
  className,
  muted,
}: {
  icon: IconKey
  className?: string
  muted?: boolean
}) {
  const Icon = CATEGORY_ICON_COMPONENTS[icon]
  return (
    <span
      aria-hidden
      className={cn(
        'inline-grid size-10 shrink-0 place-items-center rounded-lg bg-raised',
        muted ? 'text-subtle-foreground' : 'text-primary-text',
        className,
      )}
    >
      <Icon className="size-5" />
    </span>
  )
}
