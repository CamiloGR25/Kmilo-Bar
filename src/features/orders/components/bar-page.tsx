import { useState } from 'react'
import { ChevronRight, Loader2, Plus } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCop } from '@/domain/money'
import { useAuth } from '@/features/auth/use-auth'
import CashStatus, { CashRequiredNotice } from '@/features/cash/components/cash-status'
import { useOpenCashSession } from '@/features/cash/services/cash-service'
import { useNow } from '@/lib/use-now'
import { openedText, ORDER_STATUS_LABELS, OrderError, orderTitle } from '../domain/orders'
import { newId, openOrder, useOpenOrders } from '../services/orders-service'

/** Venta en barra (R-VEN-11): varias cuentas informales abiertas a la vez, con nombre opcional. */
export function BarPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const orders = useOpenOrders()
  const cash = useOpenCashSession()
  const now = useNow()
  const [label, setLabel] = useState('')
  const [pending, setPending] = useState(false)
  const barOrders = (orders.data ?? []).filter((o) => o.type === 'barra')
  const cashOpen = !!cash.data

  async function create(e: React.FormEvent) {
    e.preventDefault()
    const orderId = newId()
    setPending(true)
    try {
      await openOrder(user?.uid ?? '', orderId, { type: 'barra', label })
      navigate(`/cuentas/${orderId}`)
    } catch (err) {
      toast.error(
        err instanceof OrderError ? err.message : `No se pudo abrir: ${(err as Error).message}`,
      )
      setPending(false)
    }
  }

  return (
    <Page>
      <PageHeader
        title="Venta en barra"
        description={<CashStatus className="mt-1" />}
        back={{ to: '/mesas', label: 'Mesas' }}
      />
      {!cash.loading && !cashOpen && <CashRequiredNotice />}

      <form
        onSubmit={create}
        className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-end"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Label htmlFor="bar-label">Nombre de la cuenta (opcional)</Label>
          <Input
            id="bar-label"
            value={label}
            maxLength={40}
            placeholder="Ej. Juan, pareja de la esquina"
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <Button type="submit" size="lg" disabled={pending || !cashOpen}>
          {pending ? <Loader2 aria-hidden className="animate-spin" /> : <Plus aria-hidden />}
          Nueva cuenta de barra
        </Button>
      </form>

      <section aria-labelledby="barra-abiertas" className="flex flex-col gap-3">
        <h2 id="barra-abiertas" className="text-title font-semibold">
          Cuentas de barra abiertas
        </h2>
        {orders.loading ? (
          <div className="h-24 animate-pulse rounded-xl bg-card" />
        ) : barOrders.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card p-5 text-label text-muted-foreground">
            No hay cuentas de barra abiertas.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border bg-card">
            {barOrders.map((o) => (
              <li key={o.id}>
                <Link
                  to={`/cuentas/${o.id}`}
                  className="flex min-h-16 items-center gap-4 px-4 py-3 transition-colors hover:bg-raised"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{orderTitle(o)}</p>
                    <p className="text-meta text-subtle-foreground">
                      Cuenta #{o.number}, {openedText(o.openedAt, now)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tabular font-semibold">{formatCop(o.total)}</p>
                    <p
                      className={
                        o.status === 'por_cobrar'
                          ? 'text-meta text-warning'
                          : 'text-meta text-primary-text'
                      }
                    >
                      {ORDER_STATUS_LABELS[o.status]}
                    </p>
                  </div>
                  <ChevronRight aria-hidden className="size-5 text-subtle-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Page>
  )
}
