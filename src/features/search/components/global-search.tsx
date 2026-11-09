import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { businessDateOf } from '@/domain/dates'
import { orderTitle } from '@/features/orders/domain/orders'
import { useOpenOrders, useOrdersOfDay } from '@/features/orders/services/orders-service'
import { useProducts } from '@/features/products/services/catalog-service'
import { useCategories } from '@/features/products/services/catalog-service'
import { useSuppliers } from '@/features/purchases/services/purchases-service'
import { cn } from '@/lib/utils'
import { buildSearchIndex, KIND_LABELS, searchItems, type SearchItem } from '../domain/search'

/** Búsqueda global (F9-04): productos, cuentas y proveedores. */
export function GlobalSearch({ className }: { className?: string }) {
  const [query, setQuery] = useState('')
  return (
    <div className={cn('no-print relative w-full', className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label="Buscar producto, cuenta o proveedor"
        placeholder="Buscar producto, cuenta o proveedor"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setQuery('')
        }}
        className="h-11 pl-9"
      />
      {query.trim() && <SearchResults query={query} onPick={() => setQuery('')} />}
    </div>
  )
}

/** Solo se suscribe a los datos mientras hay una búsqueda escrita (no carga nada en reposo). */
function SearchResults({ query, onPick }: { query: string; onPick: () => void }) {
  const products = useProducts()
  const categories = useCategories()
  const suppliers = useSuppliers()
  const open = useOpenOrders()
  const [businessDate] = useState(() => businessDateOf(new Date()))
  const today = useOrdersOfDay(businessDate)

  const index = useMemo(() => {
    const categoryNames = new Map((categories.data ?? []).map((c) => [c.id, c.name]))
    const orders = new Map<string, { id: string; number: number; title: string; status: string }>()
    for (const o of [...(open.data ?? []), ...(today.data ?? [])]) {
      orders.set(o.id, { id: o.id, number: o.number, title: orderTitle(o), status: o.status })
    }
    return buildSearchIndex({
      products: (products.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        categoryName: categoryNames.get(p.categoryId) ?? '',
        stock: p.stock,
        active: p.active,
      })),
      suppliers: (suppliers.data ?? []).map((s) => ({ id: s.id, name: s.name, active: s.active })),
      orders: [...orders.values()],
    })
  }, [products.data, categories.data, suppliers.data, open.data, today.data])

  const loading = [products, categories, suppliers, open, today].some((s) => s.loading && !s.data)
  const results: SearchItem[] = loading ? [] : searchItems(query, index)

  return (
    <div className="absolute top-full right-0 left-0 z-40 mt-2 overflow-hidden rounded-lg border bg-card shadow-lg">
      {loading ? (
        <p className="px-4 py-3 text-label text-muted-foreground">Buscando…</p>
      ) : results.length === 0 ? (
        <p className="px-4 py-3 text-label text-muted-foreground">
          Sin resultados para “{query.trim()}”.
        </p>
      ) : (
        <ul aria-label="Resultados" className="max-h-96 overflow-y-auto">
          {results.map((r) => (
            <li key={`${r.kind}-${r.id}`} className="border-t first:border-t-0">
              <Link
                to={r.to}
                onClick={onPick}
                className="flex min-h-11 flex-col justify-center px-4 py-2 hover:bg-raised"
              >
                <span className="text-label font-semibold">{r.title}</span>
                <span className="text-meta text-muted-foreground">
                  {KIND_LABELS[r.kind]} · {r.subtitle}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
