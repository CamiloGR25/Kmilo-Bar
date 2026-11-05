import { useMemo, useState } from 'react'
import { ArrowLeftRight, ListTodo, Loader2, Search } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { NativeSelect } from '@/components/shared/inputs'
import { Page, PageHeader } from '@/components/shared/page-header'
import { StockIndicator } from '@/components/shared/stock-indicator'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCop } from '@/domain/money'
import { CategoryIcon } from '@/features/products/components/category-icon'
import type { Product } from '@/features/products/domain/catalog'
import { cn } from '@/lib/utils'
import { inventoryValue, type StockLevel } from '../domain/stock'
import { useInventory } from '../hooks/use-inventory'
import { MovementDialog } from './movement-dialog'
import { ReviewButton, ReviewPanel } from './review-panel'

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

const LEVELS: { level: StockLevel; label: string; tone: string }[] = [
  { level: 'agotado', label: 'Agotados', tone: 'text-destructive' },
  { level: 'minimo', label: 'En mínimo', tone: 'text-stock-low' },
  { level: 'cerca', label: 'Cerca del mínimo', tone: 'text-stock-near' },
  { level: 'ok', label: 'Stock OK', tone: 'text-success' },
]

export function InventoryPage() {
  const navigate = useNavigate()
  const { items, categories, loading, error } = useInventory()
  const [level, setLevel] = useState<StockLevel | null>(null)
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [moving, setMoving] = useState<Product | null>(null)

  const counts = useMemo(() => {
    const c: Record<StockLevel, number> = { agotado: 0, minimo: 0, cerca: 0, ok: 0 }
    for (const i of items ?? []) c[i.level]++
    return c
  }, [items])

  const list = useMemo(() => {
    const q = norm(search.trim())
    return (items ?? []).filter(
      (i) =>
        (!level || i.level === level) &&
        (!categoryId || i.product.categoryId === categoryId) &&
        (!q || norm(i.product.name).includes(q)),
    )
  }, [items, level, search, categoryId])

  const total = inventoryValue((items ?? []).map((i) => i.product))

  return (
    <Page wide>
      <PageHeader
        title="Inventario"
        description={
          items ? (
            <>
              Valor del inventario a costo:{' '}
              <span className="tabular font-semibold text-foreground">{formatCop(total)}</span>
            </>
          ) : undefined
        }
        actions={
          <>
            <ReviewButton />
            <Button asChild>
              <Link to="/inventario/recomendaciones">
                <ListTodo aria-hidden />
                Qué pedir
              </Link>
            </Button>
          </>
        }
      />

      <ReviewPanel />

      {error && (
        <p role="alert" className="text-destructive">
          No se pudo cargar el inventario: {error.message}
        </p>
      )}

      {/* Semáforo: cada nivel es un filtro */}
      <div
        role="group"
        aria-label="Filtrar por nivel de stock"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        {LEVELS.map(({ level: l, label, tone }) => {
          const active = level === l
          return (
            <button
              key={l}
              type="button"
              aria-pressed={active}
              onClick={() => setLevel(active ? null : l)}
              className={cn(
                'flex cursor-pointer flex-col items-start gap-0.5 rounded-xl border bg-card px-4 py-3 text-left transition-colors sm:gap-1 sm:p-4',
                active ? 'border-primary bg-primary/10' : 'hover:border-border-strong',
              )}
            >
              <span className={cn('text-label font-medium', tone)}>{label}</span>
              <span className="tabular text-2xl font-semibold sm:text-figure">{counts[l]}</span>
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_14rem]">
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            placeholder="Buscar producto"
            aria-label="Buscar producto"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <NativeSelect
          aria-label="Filtrar por categoría"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      </div>

      {loading ? (
        <p className="inline-flex items-center gap-2 text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Cargando inventario…
        </p>
      ) : (items ?? []).length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-8 text-muted-foreground">
          No hay productos activos.{' '}
          <Link to="/productos" className="text-primary-text hover:underline">
            Crea o importa tu catálogo
          </Link>{' '}
          para empezar a registrar stock.
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-8 text-center text-muted-foreground">
          Ningún producto coincide con el filtro.
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border bg-card">
          {list.map(({ product: p, category, level: l }) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <button
                type="button"
                onClick={() => navigate(`/inventario/${p.id}`)}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
              >
                <CategoryIcon icon={category?.icon ?? 'package'} />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 block leading-snug font-medium">{p.name}</span>
                  <span className="block text-meta text-subtle-foreground">
                    Mínimo {p.minStock}, valor {formatCop(p.stock * p.avgCost)}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span className="tabular text-xl leading-none font-semibold">{p.stock}</span>
                  <StockIndicator level={l} className="text-meta [&>span:first-child]:size-2" />
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Registrar movimiento de ${p.name}`}
                onClick={() => setMoving(p)}
              >
                <ArrowLeftRight aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {moving && (
        <MovementDialog
          product={moving}
          open={!!moving}
          onOpenChange={(o) => !o && setMoving(null)}
        />
      )}
    </Page>
  )
}
