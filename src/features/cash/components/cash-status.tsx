import { Wallet } from 'lucide-react'
import { Link } from 'react-router'
import { cn } from '@/lib/utils'
import { useOpenCashSession } from '../services/cash-service'

/**
 * Estado de la caja siempre visible (DESIGN_SYSTEM §6). Se carga de forma diferida para no
 * traer Firestore al iniciar sesión.
 */
export default function CashStatus({ className }: { className?: string }) {
  const { data, loading } = useOpenCashSession()
  if (loading) return null
  return (
    <Link
      to="/caja"
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-label font-medium transition-colors',
        data
          ? 'bg-success/12 text-success hover:bg-success/20'
          : 'bg-warning/12 text-warning hover:bg-warning/20',
        className,
      )}
    >
      <span aria-hidden className={cn('size-2 rounded-full', data ? 'bg-success' : 'bg-warning')} />
      {data ? `Caja #${data.number} abierta` : 'Caja cerrada'}
    </Link>
  )
}

/** Aviso cuando no hay caja abierta (D-110). */
export function CashRequiredNotice() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/8 px-4 py-3">
      <p className="flex items-center gap-2 text-label">
        <Wallet aria-hidden className="size-5 text-warning" />
        Abre la caja para empezar a vender.
      </p>
      <Link
        to="/caja"
        className="inline-flex h-11 items-center rounded-lg bg-primary px-4 text-[0.9375rem] font-medium text-primary-foreground hover:bg-primary-hover"
      >
        Abrir caja
      </Link>
    </div>
  )
}
