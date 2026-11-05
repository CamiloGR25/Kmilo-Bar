import { useEffect, useMemo, useState } from 'react'
import { Loader2, RotateCcw, X } from 'lucide-react'
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
import { cancelReview, finishReview, useInventoryReview } from '../services/review-service'

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
 * Revisión de inventario (R-INV-11, D-222): se cuentan todos los productos con la caja cerrada;
 * el sistema crea un movimiento "conteo" por cada diferencia, valorado al costo promedio, y al
 * terminar empieza el siguiente periodo. Solo se usa con una revisión en curso: los productos
 * sueltos se corrigen con su ajuste (⇆) en Inventario.
 */
export function CountPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { items, loading } = useInventory()
  const [draft, setDraft] = useState<Draft>(loadDraft)
  const [open, setOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const review = useInventoryReview()
  const reviewId = review.data?.inProgressId ?? null

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

  const missing = sorted.length - summary.countedN
  const canFinish = reviewId !== null && !loading && missing === 0

  const setCounted = (productId: string, v: number | null) =>
    setDraft((d) => {
      const counted = { ...d.counted }
      if (v === null) delete counted[productId]
      else counted[productId] = v
      return { ...d, counted }
    })

  if (!review.loading && !reviewId) {
    return (
      <Page>
        <PageHeader
          title="Revisión de inventario"
          description="No hay una revisión en curso. Empiézala desde Inventario con la caja cerrada. Para corregir un producto suelto, usa su botón de ajuste."
          back={{ to: '/inventario', label: 'Inventario' }}
        />
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader
        title="Revisión de inventario"
        description={`Cuenta todos los productos, uno por uno. ${missing === 0 ? 'Ya están todos.' : `Faltan ${missing}.`} La caja no se puede abrir hasta terminar.`}
        back={{ to: '/inventario', label: 'Inventario' }}
        actions={
          <>
            {summary.countedN > 0 && (
              <Button
                variant="outline"
                onClick={() => setDraft({ countId: newOpId(), counted: {} })}
              >
                <RotateCcw aria-hidden />
                Empezar de nuevo
              </Button>
            )}
            <Button variant="outline" onClick={() => setCancelling(true)}>
              <X aria-hidden />
              Cancelar revisión
            </Button>
          </>
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
        <Button disabled={!canFinish} onClick={() => setOpen(true)}>
          Terminar revisión
        </Button>
      </section>

      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title="Cancelar la revisión"
        destructive
        confirmLabel="Cancelar revisión"
        description="No se aplica ningún ajuste y la fecha de la última revisión no cambia. Lo que llevas contado queda guardado en este navegador."
        onConfirm={async () => {
          try {
            await cancelReview(user?.uid ?? '', reviewId ?? '')
            toast.success('Revisión cancelada. Ya se puede abrir caja.')
          } catch (e) {
            toast.error(`No se pudo cancelar: ${(e as Error).message}`)
          }
        }}
      />

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Terminar la revisión"
        confirmLabel="Terminar revisión"
        description={`Se ajustará el stock de ${summary.diffs} productos al valor contado y la revisión quedará hecha hoy. Cada ajuste queda en el kardex y no se puede deshacer.`}
        onConfirm={async () => {
          if (!reviewId) return
          const lines = sorted
            .filter((i) => {
              const c = draft.counted[i.product.id]
              return c !== undefined && c !== i.product.stock
            })
            .map((i) => ({ productId: i.product.id, counted: draft.counted[i.product.id]! }))
          try {
            const uid = user?.uid ?? ''
            // El ID del conteo es el de la revisión: si se reintenta, no se duplica.
            const r = await applyCount(uid, reviewId, lines, 'Revisión de inventario periódica')
            await finishReview(
              uid,
              reviewId,
              `Revisión de inventario terminada: ${sorted.length} productos contados, ${r.adjusted} ajustados por ${formatCop(summary.value)}`,
            )
            toast.success(`Revisión terminada: ${r.adjusted} productos ajustados`)
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
