import { cn } from '@/lib/utils'

/** Botón de opción (pastilla) usado en los formularios de gastos y capital. */
export const choiceClass = (active: boolean) =>
  cn(
    'h-11 flex-1 cursor-pointer rounded-lg border px-3 text-label font-medium',
    active
      ? 'border-primary bg-primary/15 text-foreground'
      : 'text-muted-foreground hover:bg-raised',
  )
