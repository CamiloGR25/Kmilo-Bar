import { useMemo, useState } from 'react'
import { FileUp, PackageOpen, Plus, Search } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { NativeSelect } from '@/components/shared/inputs'
import { Page, PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { marginOf } from '@/domain/metrics/pricing'
import { formatBp, formatCop } from '@/domain/money'
import { useAuth } from '@/features/auth/use-auth'
import { useSettings } from '@/features/settings/services/settings-service'
import { cn } from '@/lib/utils'
import { SAMPLE_CATALOG, type Category, type Product } from '../domain/catalog'
import { importProducts, useCategories, useProducts } from '../services/catalog-service'
import { CategoryIcon } from './category-icon'

type StatusFilter = 'activos' | 'inactivos' | 'todos'

/** Normaliza para buscar sin importar tildes ni mayúsculas. */
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export function ProductsPage() {
  const products = useProducts()
  const categories = useCategories()
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [status, setStatus] = useState<StatusFilter>('activos')

  const byId = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c])),
    [categories.data],
  )
  const list = useMemo(() => {
    const q = norm(search.trim())
    return (products.data ?? []).filter(
      (p) =>
        (status === 'todos' || (status === 'activos' ? p.active : !p.active)) &&
        (!categoryId || p.categoryId === categoryId) &&
        (!q || norm(p.name).includes(q) || norm(p.description).includes(q)),
    )
  }, [products.data, search, categoryId, status])

  const total = products.data?.length ?? 0
  const loading = products.loading || categories.loading

  return (
    <Page wide>
      <PageHeader
        title="Productos"
        description={
          loading
            ? 'Cargando catálogo…'
            : total === 1
              ? '1 producto en el catálogo'
              : `${total} productos en el catálogo`
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/productos/importar">
                <FileUp aria-hidden />
                Importar
              </Link>
            </Button>
            <Button asChild>
              <Link to="/productos/nuevo">
                <Plus aria-hidden />
                Nuevo producto
              </Link>
            </Button>
          </>
        }
      />

      {products.error && (
        <p role="alert" className="text-destructive">
          No se pudo cargar el catálogo: {products.error.message}
        </p>
      )}

      {!loading && total === 0 ? (
        <EmptyCatalog categories={categories.data ?? []} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_14rem_11rem]">
            <div className="relative col-span-2 sm:col-span-1">
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
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Filtrar por estado"
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
            >
              <option value="activos">Activos</option>
              <option value="inactivos">Inactivos</option>
              <option value="todos">Todos</option>
            </NativeSelect>
          </div>

          {list.length === 0 && !loading ? (
            <div className="rounded-xl border border-dashed bg-card p-8 text-center text-muted-foreground">
              Ningún producto coincide con la búsqueda.
            </div>
          ) : (
            <ProductTable products={list} categories={byId} />
          )}
        </>
      )}
    </Page>
  )
}

function ProductTable({
  products,
  categories,
}: {
  products: Product[]
  categories: Map<string, Category>
}) {
  const navigate = useNavigate()
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      {/* Encabezados (solo escritorio) */}
      <div
        aria-hidden
        className="hidden grid-cols-[minmax(0,1fr)_7rem_7rem_6rem_6rem] gap-4 border-b px-5 py-3 text-meta font-medium text-subtle-foreground md:grid"
      >
        <span>Producto</span>
        <span className="text-right">Costo</span>
        <span className="text-right">Precio</span>
        <span className="text-right">Margen</span>
        <span className="text-right">Modo</span>
      </div>
      <ul className="divide-y divide-border">
        {products.map((p) => {
          const cat = categories.get(p.categoryId)
          const margin = marginOf(p.avgCost, p.salePrice)
          const lowMargin = margin !== null && margin < 1000
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => navigate(`/productos/${p.id}`)}
                className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3.5 text-left transition-colors hover:bg-raised/60 sm:px-5 md:grid-cols-[minmax(0,1fr)_7rem_7rem_6rem_6rem]"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <CategoryIcon icon={cat?.icon ?? 'package'} muted={!p.active} />
                  <span className="min-w-0">
                    <span
                      className={cn(
                        'block truncate font-medium',
                        !p.active && 'text-muted-foreground',
                      )}
                    >
                      {p.name}
                    </span>
                    <span className="block truncate text-meta text-subtle-foreground">
                      {cat?.name ?? 'Sin categoría'}, {p.unit}
                      {!p.active && ', inactivo'}
                    </span>
                  </span>
                </span>
                {/* Celular: precio a la derecha */}
                <span className="text-right tabular font-semibold md:hidden">
                  {formatCop(p.salePrice)}
                </span>
                <span className="hidden text-right tabular text-muted-foreground md:block">
                  {formatCop(p.avgCost)}
                </span>
                <span className="hidden text-right tabular font-semibold md:block">
                  {formatCop(p.salePrice)}
                </span>
                <span
                  className={cn(
                    'hidden text-right tabular md:block',
                    lowMargin ? 'text-warning' : 'text-muted-foreground',
                  )}
                >
                  {margin === null ? '—' : formatBp(margin)}
                </span>
                <span className="hidden text-right md:block">
                  <PricingBadge mode={p.pricingMode} />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function PricingBadge({ mode }: { mode: Product['pricingMode'] }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded-full px-2.5 text-meta font-medium',
        mode === 'auto' ? 'bg-primary/15 text-primary-text' : 'bg-raised text-muted-foreground',
      )}
    >
      {mode === 'auto' ? 'Automático' : 'Manual'}
    </span>
  )
}

function EmptyCatalog({ categories }: { categories: Category[] }) {
  const { user } = useAuth()
  const settings = useSettings()
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col items-start gap-4 rounded-xl border border-dashed bg-card p-6 sm:p-8">
      <PackageOpen aria-hidden className="size-9 text-subtle-foreground" />
      <div>
        <p className="text-title font-semibold">Tu catálogo está vacío</p>
        <p className="mt-1 max-w-prose text-label text-muted-foreground">
          Crea tus productos uno a uno, impórtalos desde un archivo CSV o carga un catálogo de
          ejemplo para probar el sistema.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to="/productos/nuevo">
            <Plus aria-hidden />
            Crear producto
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/productos/importar">
            <FileUp aria-hidden />
            Importar CSV
          </Link>
        </Button>
        <Button variant="secondary" onClick={() => setOpen(true)} disabled={!settings.data}>
          Cargar catálogo de ejemplo
        </Button>
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Cargar catálogo de ejemplo"
        confirmLabel={`Cargar ${SAMPLE_CATALOG.length} productos`}
        description={`Se crearán ${SAMPLE_CATALOG.length} productos genéricos con costos ficticios, solo para probar. Podrás editarlos o desactivarlos después.`}
        onConfirm={async () => {
          if (!settings.data) return
          const r = await importProducts(
            user?.uid ?? '',
            SAMPLE_CATALOG,
            categories,
            [],
            settings.data.settings,
            'ejemplo',
          )
          toast.success(`${r.created} productos de ejemplo creados`)
        }}
      />
    </div>
  )
}
