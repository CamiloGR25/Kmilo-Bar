import { Motorbike } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Nombre del negocio (provisional hasta que exista en Configuración, Fase 2). */
export const BUSINESS_NAME = 'Kmilo Bar'

const MARK_SIZES = {
  sm: { box: 'size-9 rounded-[0.625rem]', icon: 'size-5' },
  md: { box: 'size-11 rounded-xl', icon: 'size-6' },
  lg: { box: 'size-14 rounded-2xl', icon: 'size-8' },
} as const

/** Marca de Kmilo Bar: moto en blanco sobre placa azul. */
export function BrandMark({
  size = 'md',
  className,
}: {
  size?: keyof typeof MARK_SIZES
  className?: string
}) {
  const s = MARK_SIZES[size]
  return (
    <span
      aria-hidden
      className={cn(
        'inline-grid shrink-0 place-items-center bg-primary text-primary-foreground ring-1 ring-primary-text/25 ring-inset',
        s.box,
        className,
      )}
    >
      <Motorbike className={s.icon} strokeWidth={2} />
    </span>
  )
}

/** Marca + nombre, para encabezados compactos (menú lateral, login en celular). */
export function BrandLockup({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  return (
    <span className="inline-flex items-center gap-3">
      <BrandMark size={size} />
      <span
        className={cn(
          'font-semibold tracking-tight',
          size === 'sm' ? 'text-[1.125rem]' : 'text-title',
        )}
      >
        {BUSINESS_NAME}
      </span>
    </span>
  )
}
