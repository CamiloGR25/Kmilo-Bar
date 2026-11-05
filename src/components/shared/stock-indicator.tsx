import { cn } from '@/lib/utils'

/** Estados del semáforo de stock (BUSINESS_RULES R-INV-06). */
export type StockLevel = 'ok' | 'cerca' | 'minimo' | 'agotado'

const LEVELS: Record<StockLevel, { label: string; dot: string; text: string }> = {
  ok: { label: 'Stock OK', dot: 'bg-success', text: 'text-success' },
  cerca: { label: 'Cerca del mínimo', dot: 'bg-stock-near', text: 'text-stock-near' },
  minimo: { label: 'En mínimo', dot: 'bg-stock-low', text: 'text-stock-low' },
  agotado: { label: 'Agotado', dot: 'bg-destructive-solid', text: 'text-destructive' },
}

/**
 * Indicador de stock: punto de color + texto (el color nunca es la única señal).
 * "En mínimo" lleva un anillo para distinguirse de "Cerca del mínimo" sin depender del tono.
 */
export function StockIndicator({ level, className }: { level: StockLevel; className?: string }) {
  const { label, dot, text } = LEVELS[level]
  return (
    <span className={cn('inline-flex items-center gap-2 text-label font-medium', text, className)}>
      <span
        aria-hidden
        className={cn(
          'size-2.5 shrink-0 rounded-full',
          dot,
          level === 'minimo' && 'ring-2 ring-stock-low/40 ring-offset-2 ring-offset-card',
        )}
      />
      {label}
    </span>
  )
}
