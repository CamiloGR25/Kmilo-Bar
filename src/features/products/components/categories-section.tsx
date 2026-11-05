import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { FormField } from '@/features/auth/components/form-field'
import { useAuth } from '@/features/auth/use-auth'
import { cn } from '@/lib/utils'
import { CATEGORY_ICONS, type Category, type CategoryIcon as IconKey } from '../domain/catalog'
import {
  saveCategory,
  setCategoryActive,
  swapCategoryOrder,
  useCategories,
  useProducts,
} from '../services/catalog-service'
import { CategoryIcon } from './category-icon'
import { CATEGORY_ICON_COMPONENTS, CATEGORY_ICON_LABELS } from './category-icons'

/** Gestión de categorías: crear, editar, ordenar y activar/desactivar (no se borran). */
export function CategoriesSection() {
  const { user } = useAuth()
  const { data: categories = [], loading } = useCategories()
  const { data: products = [] } = useProducts()
  const [editing, setEditing] = useState<Category | 'new' | null>(null)

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of products) m.set(p.categoryId, (m.get(p.categoryId) ?? 0) + 1)
    return m
  }, [products])

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-title font-semibold">Categorías</h2>
          <p className="mt-1 text-label text-muted-foreground">
            Una categoría desactivada no aparecerá al vender, pero conserva sus productos.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setEditing('new')}>
          <Plus aria-hidden />
          Nueva categoría
        </Button>
      </div>

      <ul className="divide-y divide-border rounded-xl border bg-card">
        {loading && <li className="px-5 py-4 text-muted-foreground">Cargando categorías…</li>}
        {categories.map((c, i) => {
          const count = counts.get(c.id) ?? 0
          return (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <CategoryIcon icon={c.icon} muted={!c.active} />
              <div className="min-w-0 flex-1">
                <p className={cn('font-medium', !c.active && 'text-muted-foreground')}>{c.name}</p>
                <p className="text-meta text-subtle-foreground">
                  {count === 1 ? '1 producto' : `${count} productos`}
                  {!c.active && ', desactivada'}
                </p>
              </div>
              <div className="hidden items-center sm:flex">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Subir ${c.name}`}
                  disabled={i === 0}
                  onClick={() => swapCategoryOrder(c, categories[i - 1]!)}
                >
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Bajar ${c.name}`}
                  disabled={i === categories.length - 1}
                  onClick={() => swapCategoryOrder(c, categories[i + 1]!)}
                >
                  <ArrowDown aria-hidden />
                </Button>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Editar ${c.name}`}
                onClick={() => setEditing(c)}
              >
                <Pencil aria-hidden />
              </Button>
              <Switch
                checked={c.active}
                aria-label={c.active ? `Desactivar ${c.name}` : `Activar ${c.name}`}
                onCheckedChange={async (v) => {
                  try {
                    await setCategoryActive(user?.uid ?? '', c, v)
                    toast.success(`Categoría ${v ? 'activada' : 'desactivada'}`)
                  } catch (e) {
                    toast.error((e as Error).message)
                  }
                }}
              />
            </li>
          )
        })}
      </ul>

      <CategoryDialog
        key={editing === 'new' ? 'new' : (editing?.id ?? 'none')}
        category={editing === 'new' ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        all={categories}
        uid={user?.uid ?? ''}
      />
    </section>
  )
}

function CategoryDialog({
  category,
  open,
  onClose,
  all,
  uid,
}: {
  category: Category | null
  open: boolean
  onClose: () => void
  all: Category[]
  uid: string
}) {
  const [name, setName] = useState(category?.name ?? '')
  const [icon, setIcon] = useState<IconKey>(category?.icon ?? 'package')
  const [pending, setPending] = useState(false)
  const duplicate = all.some(
    (c) => c.id !== category?.id && c.name.trim().toLowerCase() === name.trim().toLowerCase(),
  )
  const error =
    name.trim() === ''
      ? 'Escribe el nombre.'
      : duplicate
        ? 'Ya existe una categoría con ese nombre.'
        : null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-title">
            {category ? 'Editar categoría' : 'Nueva categoría'}
          </DialogTitle>
          <DialogDescription className="text-label">
            El ícono identifica a sus productos en el catálogo.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={async (e) => {
            e.preventDefault()
            if (error) return
            setPending(true)
            try {
              await saveCategory(uid, { name: name.trim(), icon }, category, all)
              toast.success(category ? 'Categoría actualizada' : 'Categoría creada')
              onClose()
            } catch (err) {
              toast.error((err as Error).message)
            } finally {
              setPending(false)
            }
          }}
        >
          <FormField
            id="category-name"
            label="Nombre"
            error={name ? (error ?? undefined) : undefined}
          >
            <Input
              id="category-name"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </FormField>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-label font-medium">Ícono</legend>
            <div className="grid grid-cols-5 gap-2">
              {CATEGORY_ICONS.map((key) => {
                const Icon = CATEGORY_ICON_COMPONENTS[key]
                const selected = key === icon
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={selected}
                    aria-label={CATEGORY_ICON_LABELS[key]}
                    title={CATEGORY_ICON_LABELS[key]}
                    onClick={() => setIcon(key)}
                    className={cn(
                      'grid h-12 cursor-pointer place-items-center rounded-lg border transition-colors',
                      selected
                        ? 'border-primary bg-primary/15 text-primary-text'
                        : 'border-transparent bg-raised text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="size-5" />
                  </button>
                )
              })}
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!!error || pending}>
              {pending && <Loader2 aria-hidden className="animate-spin" />}
              {category ? 'Guardar' : 'Crear categoría'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
