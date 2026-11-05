import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { formatCop } from '@/domain/money'
import { CATEGORY_ICON_COMPONENTS } from '@/features/products/components/category-icons'
import type { InventoryItem } from '@/features/inventory/hooks/use-inventory'
import type { Category } from '@/features/products/domain/catalog'
import { cn } from '@/lib/utils'

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

const DOT: Record<InventoryItem['level'], string> = {
  ok: 'bg-success',
  cerca: 'bg-stock-near',
  minimo: 'bg-stock-low',
  agotado: 'bg-destructive-solid',
}

/**
 * Selector de productos por categoría con búsqueda y stock visible (DESIGN_SYSTEM §8.3).
 * Solo productos activos con precio (R-INV-10, D-217). Los agotados se ven, pero no se tocan.
 */
export function ProductPicker({
  items,
  categories,
  inRound,
  disabled,
  onPick,
}: {
  items: InventoryItem[]
  categories: Category[]
  /** Unidades ya puestas en la ronda, por producto. */
  inRound: Map<string, number>
  disabled?: boolean
  onPick: (item: InventoryItem) => void
}) {
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)

  const sellable = useMemo(
    () =>
      items
        .filter((i) => i.product.active && i.product.salePrice > 0)
        .sort((a, b) => a.product.name.localeCompare(b.product.name, 'es')),
    [items],
  )
  const usedCategories = useMemo(() => {
    const ids = new Set(sellable.map((i) => i.product.categoryId))
    return categories.filter((c) => ids.has(c.id))
  }, [sellable, categories])

  const q = norm(search.trim())
  const list = sellable.filter((i) =>
    q ? norm(i.product.name).includes(q) : !categoryId || i.product.categoryId === categoryId,
  )

  return (
    <section aria-label="Productos" className="flex flex-col gap-3">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar producto"
          aria-label="Buscar producto"
          className="pl-10"
        />
      </div>

      {!q && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          <Chip active={categoryId === null} onClick={() => setCategoryId(null)}>
            Todos
          </Chip>
          {usedCategories.map((c) => {
            const Icon = CATEGORY_ICON_COMPONENTS[c.icon]
            return (
              <Chip key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(c.id)}>
                <Icon aria-hidden className="size-4" />
                {c.name}
              </Chip>
            )
          })}
        </div>
      )}

      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card p-5 text-label text-muted-foreground">
          {sellable.length === 0
            ? 'No hay productos a la venta. Revisa el catálogo y el inventario.'
            : 'Ningún producto coincide.'}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {list.map((i) => {
            const picked = inRound.get(i.product.id) ?? 0
            const left = i.product.stock - picked
            const out = left <= 0
            return (
              <li key={i.product.id}>
                <button
                  type="button"
                  disabled={disabled || out}
                  onClick={() => onPick(i)}
                  className={cn(
                    'relative flex h-full min-h-[4.5rem] w-full flex-col gap-1 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors',
                    'cursor-pointer hover:border-border-strong hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50',
                    picked > 0 && 'border-primary/70 bg-primary/8',
                  )}
                >
                  <span className="line-clamp-2 text-[0.9375rem] leading-snug font-medium">
                    {i.product.name}
                  </span>
                  <span className="mt-auto flex items-center justify-between gap-2">
                    <span className="tabular text-label font-semibold">
                      {formatCop(i.product.salePrice)}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-meta text-subtle-foreground">
                      <span aria-hidden className={cn('size-2 rounded-full', DOT[i.level])} />
                      <span className="tabular">
                        {i.product.stock === 0 ? 'Agotado' : `Quedan ${left}`}
                      </span>
                    </span>
                  </span>
                  {picked > 0 && (
                    <span className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-primary tabular text-meta font-semibold text-primary-foreground">
                      {picked}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-label font-medium whitespace-nowrap transition-colors',
        active
          ? 'border-primary bg-primary/15 text-foreground'
          : 'text-muted-foreground hover:bg-raised hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
