import { useEffect, useMemo, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { IntegerInput } from '@/components/shared/inputs'
import { Page, PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { formatCop } from '@/domain/money'
import { useAuth } from '@/features/auth/use-auth'
import { cn } from '@/lib/utils'
import { useInventory } from '../hooks/use-inventory'
import { applyCount, newOpId } from '../services/inventory-service'

const DRAFT_KEY = 'kmilo-bar:conteo-borrador'

interface Draft {
  countId: string
  counted: Record<string, number>
}

/** El borrador del conteo se guarda en este navegador (si se cierra la pestaña, no se pierde). */
function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (raw) return JSON.parse(raw) as Draft
  } catch {
    /* sin almacenamiento disponible */
  }
  return { countId: newOpId(), counted: {} }
}

/**
 * Conteo físico (F3-08): escribe lo que hay en el estante; el sistema crea un movimiento
 * "conteo" por cada diferencia, valorado al costo promedio.
 */
export function CountPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { items, loading } = useInventory()
  const [draft, setDraft] = useState<Draft>(loadDraft)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    } catch {
      /* ignorar */
    }
  }, [draft])

  const sorted = useMemo(() => {
    const list = [...(items ?? [])].sort(
      (a, b) =>
        (a.category?.name ?? '').localeCompare(b.category?.name ?? '', 'es') ||
        a.product.name.localeCompare(b.product.name, 'es'),
    )
    // Marca el primer producto de cada categoría para mostrar su encabezado.
    return list.map((item, idx) => ({
      ...item,
      header:
        idx === 0 || list[idx - 1]!.category?.name !== item.category?.name
          ? (item.category?.name ?? 'Sin categoría')
          : null,
    }))
  }, [items])

  const summary = useMemo(() => {
    let countedN = 0
    let diffs = 0
    let value = 0
    for (const i of sorted) {
      const c = draft.counted[i.product.id]
      if (c === undefined) continue
      countedN++
      const d = c - i.product.stock
      if (d !== 0) {
        diffs++
        value += d * i.product.avgCost
      }
    }
    return { countedN, diffs, value }
  }, [sorted, draft])

  const setCounted = (productId: string, v: number | null) =>
    setDraft((d) => {
      const counted = { ...d.counted }
      if (v === null) delete counted[productId]
      else counted[productId] = v
      return { ...d, counted }
    })

  return (
    <Page>
      <PageHeader
        title="Conteo físico"
        description="Cuenta lo que hay en el bar y escríbelo. Deja en blanco lo que no cuentes."
        back={{ to: '/inventario', label: 'Inventario' }}
        actions={
          summary.countedN > 0 && (
            <Button variant="outline" onClick={() => setDraft({ countId: newOpId(), counted: {} })}>
              <RotateCcw aria-hidden />
              Empezar de nuevo
            </Button>
          )
        }
      />

      {loading ? (
        <p className="inline-flex items-center gap-2 text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Cargando…
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border bg-card">
          {sorted.map((i) => {
            const c = draft.counted[i.product.id]
            const diff = c === undefined ? null : c - i.product.stock
            return (
              <li key={i.product.id}>
                {i.header && (
                  <p className="bg-raised/40 px-5 py-2 text-label font-medium text-muted-foreground">
                    {i.header}
                  </p>
                )}
                <div className="grid grid-cols-[1fr_7rem] items-center gap-4 px-4 py-3 sm:grid-cols-[1fr_8rem] sm:px-5">
                  <div className="min-w-0">
                    <p className="line-clamp-2 leading-snug font-medium">{i.product.name}</p>
                    <p className="text-meta text-subtle-foreground">
                      Sistema: <span className="tabular">{i.product.stock}</span>
                      {diff !== null && diff !== 0 && (
                        <span
                          className={cn(
                            'ml-2 font-medium',
                            diff > 0 ? 'text-success' : 'text-destructive',
                          )}
                        >
                          {diff > 0 ? `sobran ${diff}` : `faltan ${Math.abs(diff)}`}
                        </span>
                      )}
                      {diff === 0 && <span className="ml-2 font-medium text-success">cuadra</span>}
                    </p>
                  </div>
                  <IntegerInput
                    aria-label={`Contado de ${i.product.name}`}
                    value={c ?? null}
                    onChange={(v) => setCounted(i.product.id, v)}
                    className="text-right"
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <section className="sticky bottom-20 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl border bg-card px-5 py-4 shadow-lg shadow-black/30 lg:bottom-4">
        <p className="text-label text-muted-foreground">
          <span className="tabular font-semibold text-foreground">{summary.countedN}</span>{' '}
          contados, <span className="tabular font-semibold text-foreground">{summary.diffs}</span>{' '}
          con diferencia
          {summary.diffs > 0 && (
            <>
              {' '}
              por{' '}
              <span
                className={cn(
                  'tabular font-semibold',
                  summary.value < 0 ? 'text-destructive' : 'text-foreground',
                )}
              >
                {formatCop(summary.value)}
              </span>
            </>
          )}
        </p>
        <Button disabled={summary.diffs === 0} onClick={() => setOpen(true)}>
          Aplicar {summary.diffs} {summary.diffs === 1 ? 'ajuste' : 'ajustes'}
        </Button>
      </section>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Aplicar conteo"
        requireReason
        confirmLabel="Aplicar"
        description={`Se ajustará el stock de ${summary.diffs} productos al valor contado. Cada ajuste queda en el kardex del producto y no se puede deshacer (se corrige con otro movimiento).`}
        onConfirm={async (reason) => {
          const lines = sorted
            .filter((i) => {
              const c = draft.counted[i.product.id]
              return c !== undefined && c !== i.product.stock
            })
            .map((i) => ({ productId: i.product.id, counted: draft.counted[i.product.id]! }))
          try {
            const r = await applyCount(
              user?.uid ?? '',
              draft.countId,
              lines,
              reason ?? 'Conteo físico',
            )
            toast.success(`Conteo aplicado: ${r.adjusted} productos ajustados`)
            setDraft({ countId: newOpId(), counted: {} })
            navigate('/inventario')
          } catch (e) {
            toast.error(`No se pudo aplicar: ${(e as Error).message}`)
          }
        }}
      />
    </Page>
  )
}
