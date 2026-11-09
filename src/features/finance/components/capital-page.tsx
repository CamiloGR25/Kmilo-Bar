import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Page, PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { formatBusinessDate } from '@/domain/dates'
import { formatCop } from '@/domain/money'
import { useAuth } from '@/features/auth/use-auth'
import { cn } from '@/lib/utils'
import { CAPITAL_LABELS, type CapitalEntry, type CapitalType } from '../domain/finance'
import { useCapitalEntries, voidCapital } from '../services/finance-service'
import { CapitalDialog } from './capital-dialogs'

/** Capital (F8-04, R-FIN-02): inversión inicial por ítems, aportes y retiros del dueño. */
export function CapitalPage() {
  const { user } = useAuth()
  const entries = useCapitalEntries()
  const [adding, setAdding] = useState<CapitalType | null>(null)
  const [voiding, setVoiding] = useState<CapitalEntry | null>(null)
  const list = entries.data ?? []
  const total = (t: CapitalType) =>
    list.filter((e) => e.status === 'activo' && e.type === t).reduce((s, e) => s + e.amount, 0)
  const groups: CapitalType[] = ['inversion_inicial', 'aporte', 'retiro']

  return (
    <Page>
      <PageHeader
        title="Capital e inversión"
        description="Tu plata en el negocio: lo que invertiste para abrir, lo que aportas después y las ganancias que retiras. No son ventas ni gastos."
        back={{ to: '/finanzas', label: 'Finanzas' }}
        actions={
          <>
            <Button variant="outline" onClick={() => setAdding('retiro')}>
              Retiro de ganancias
            </Button>
            <Button variant="outline" onClick={() => setAdding('aporte')}>
              Aporte
            </Button>
            <Button onClick={() => setAdding('inversion_inicial')}>
              <Plus aria-hidden />
              Ítem de inversión
            </Button>
          </>
        }
      />

      <dl className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3">
        {groups.map((t) => (
          <div key={t} className="flex flex-col gap-1 bg-card px-5 py-4">
            <dt className="text-label text-muted-foreground">{CAPITAL_LABELS[t]}</dt>
            <dd className="tabular text-xl font-semibold">{formatCop(total(t))}</dd>
          </div>
        ))}
      </dl>
      <p className="text-label text-muted-foreground">
        El equipamiento que compras después de abrir se registra en Gastos como inversión y también
        cuenta para la recuperación.
      </p>

      {entries.loading ? (
        <p className="inline-flex items-center gap-2 text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Cargando…
        </p>
      ) : (
        groups.map((t) => {
          const items = list.filter((e) => e.type === t)
          return (
            <section key={t} className="flex flex-col gap-3">
              <h2 className="text-title font-semibold">{CAPITAL_LABELS[t]}</h2>
              {items.length === 0 ? (
                <p className="text-label text-muted-foreground">
                  {t === 'inversion_inicial'
                    ? 'Agrega cada cosa en la que invertiste: adecuación, neveras, mesas, sonido…'
                    : 'Sin registros.'}
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-xl border bg-card">
                  {items.map((e) => {
                    const voided = e.status === 'anulado'
                    return (
                      <li
                        key={e.id}
                        className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5"
                      >
                        <div className="min-w-0">
                          <p
                            className={cn(
                              'font-medium',
                              voided && 'text-subtle-foreground line-through',
                            )}
                          >
                            {e.description || CAPITAL_LABELS[e.type]}
                          </p>
                          <p className="text-meta text-subtle-foreground">
                            {formatBusinessDate(e.businessDate)}
                            {e.fromCash && ', por la caja'}
                            {voided && e.voidReason && `. Anulado: ${e.voidReason}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'tabular font-semibold',
                              voided && 'text-subtle-foreground line-through',
                            )}
                          >
                            {formatCop(e.amount)}
                          </span>
                          {!voided && !e.fromCash && (
                            <Button variant="ghost" onClick={() => setVoiding(e)}>
                              Anular
                            </Button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )
        })
      )}

      {adding && <CapitalDialog open type={adding} onOpenChange={(o) => !o && setAdding(null)} />}
      <ConfirmDialog
        open={voiding !== null}
        onOpenChange={(o) => !o && setVoiding(null)}
        title="Anular registro"
        destructive
        requireReason
        confirmLabel="Anular"
        description="Queda anulado (no se borra) y deja de contar en las finanzas."
        onConfirm={async (reason) => {
          if (!voiding) return
          try {
            await voidCapital(user?.uid ?? '', voiding, reason ?? '')
            toast.success('Registro anulado')
          } catch (e) {
            toast.error((e as Error).message)
          }
        }}
      />
    </Page>
  )
}
