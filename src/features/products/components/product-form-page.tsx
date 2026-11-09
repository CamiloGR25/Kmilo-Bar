import { useMemo, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertTriangle, History, Loader2 } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { IntegerInput, MoneyInput, NativeSelect, PercentInput } from '@/components/shared/inputs'
import { Page, PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { formatDateTime } from '@/domain/dates'
import { computePricing } from '@/domain/metrics/pricing'
import { bpToPercent, formatBp, formatCop, percentToBp } from '@/domain/money'
import { FormField } from '@/features/auth/components/form-field'
import { useAuth } from '@/features/auth/use-auth'
import { Section } from '@/features/settings/components/settings-page'
import type { Settings } from '@/features/settings/domain/settings'
import { useSettings } from '@/features/settings/services/settings-service'
import type { Supplier } from '@/features/purchases/domain/purchases'
import { useSuppliers } from '@/features/purchases/services/purchases-service'
import { cn } from '@/lib/utils'
import { UNITS, type Category, type Product } from '../domain/catalog'
import { productFormSchema, type ProductFormValues } from '../schemas/product-schema'
import {
  createProduct,
  setProductActive,
  updateProduct,
  useCategories,
  usePriceHistory,
  useProducts,
  type PriceHistoryEntry,
} from '../services/catalog-service'

export function ProductFormPage() {
  const { id } = useParams()
  const isNew = !id
  const products = useProducts()
  const categories = useCategories()
  const settings = useSettings()
  const suppliers = useSuppliers()

  const product = isNew ? null : (products.data?.find((p) => p.id === id) ?? null)
  const loading = products.loading || categories.loading || settings.loading

  return (
    <Page wide>
      <PageHeader
        title={isNew ? 'Nuevo producto' : (product?.name ?? 'Producto')}
        back={{ to: '/productos', label: 'Productos' }}
      />
      {loading || !settings.data ? (
        <p className="inline-flex items-center gap-2 text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Cargando…
        </p>
      ) : !isNew && !product ? (
        <p className="text-destructive">No se encontró el producto.</p>
      ) : (
        <ProductForm
          key={product?.id ?? 'new'}
          product={product}
          categories={categories.data ?? []}
          settings={settings.data.settings}
          suppliers={suppliers.data ?? []}
          existingNames={(products.data ?? [])
            .filter((p) => p.id !== product?.id)
            .map((p) => p.name.trim().toLowerCase())}
        />
      )}
    </Page>
  )
}

function defaults(product: Product | null, settings: Settings, categories: Category[]) {
  if (!product) {
    return {
      name: '',
      description: '',
      categoryId: categories.find((c) => c.active)?.id ?? '',
      unit: 'unidad',
      cost: null as unknown as number,
      pricingMode: 'auto',
      markupMode: 'global',
      markupBp: null,
      manualPrice: null,
      minStock: settings.defaultMinStock,
      active: true,
      supplierId: '',
      purchaseUnit: '',
      unitsPerPurchase: null,
    } satisfies Record<keyof ProductFormValues, unknown>
  }
  return {
    name: product.name,
    description: product.description,
    categoryId: product.categoryId,
    unit: product.unit,
    cost: product.avgCost,
    pricingMode: product.pricingMode,
    markupMode: product.markupBp === null ? 'global' : 'custom',
    markupBp: product.markupBp,
    manualPrice: product.pricingMode === 'manual' ? product.salePrice : null,
    minStock: product.minStock,
    active: product.active,
    supplierId: product.supplierId ?? '',
    purchaseUnit: product.purchaseUnit ?? '',
    unitsPerPurchase: product.unitsPerPurchase,
  } satisfies ProductFormValues
}

function ProductForm({
  product,
  categories,
  settings,
  suppliers,
  existingNames,
}: {
  product: Product | null
  categories: Category[]
  settings: Settings
  suppliers: Supplier[]
  existingNames: string[]
}) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const uid = user?.uid ?? ''
  const {
    control,
    register,
    handleSubmit,
    setError,
    setValue,
    getValues,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: defaults(product, settings, categories) as ProductFormValues,
  })

  const v = useWatch({ control })
  const costLocked = !!product && product.stock > 0

  const pricing = useMemo(() => {
    if (typeof v.cost !== 'number') return null
    return computePricing(
      {
        cost: v.cost,
        pricingMode: v.pricingMode ?? 'auto',
        markupBp: v.markupMode === 'custom' ? (v.markupBp ?? null) : null,
        manualPrice: v.pricingMode === 'manual' ? (v.manualPrice ?? null) : null,
      },
      settings,
    )
  }, [v.cost, v.pricingMode, v.markupMode, v.markupBp, v.manualPrice, settings])

  const selectable = categories.filter((c) => c.active || c.id === product?.categoryId)

  const onSubmit = handleSubmit(async (values) => {
    if (existingNames.includes(values.name.trim().toLowerCase())) {
      setError('name', { message: 'Ya existe un producto con ese nombre.' })
      return
    }
    try {
      if (product) {
        await updateProduct(uid, product, values, settings, null)
        toast.success('Producto actualizado')
      } else {
        await createProduct(uid, values, settings)
        toast.success('Producto creado')
      }
      navigate('/productos')
    } catch (e) {
      toast.error(`No se pudo guardar: ${(e as Error).message}`)
    }
  })

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]"
    >
      <div className="flex flex-col gap-8">
        <Section title="Producto">
          <FormField id="name" label="Nombre" error={errors.name?.message}>
            <Input
              id="name"
              maxLength={80}
              aria-invalid={!!errors.name}
              placeholder="Ej. Cerveza nacional 330 ml"
              {...register('name')}
            />
          </FormField>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField id="categoryId" label="Categoría" error={errors.categoryId?.message}>
              <NativeSelect id="categoryId" {...register('categoryId')}>
                {selectable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {!c.active ? ' (desactivada)' : ''}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id="unit" label="Unidad de venta">
              <NativeSelect id="unit" {...register('unit')}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u[0]!.toUpperCase() + u.slice(1)}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </div>
          <FormField
            id="description"
            label="Descripción (opcional)"
            error={errors.description?.message}
          >
            <Textarea id="description" maxLength={300} {...register('description')} />
          </FormField>
        </Section>

        <Section title="Precio">
          <FormField id="cost" label="Costo de compra por unidad" error={errors.cost?.message}>
            <Controller
              control={control}
              name="cost"
              render={({ field }) => (
                <MoneyInput
                  id="cost"
                  value={field.value ?? null}
                  onChange={(n) => field.onChange(n ?? undefined)}
                  disabled={costLocked}
                  aria-invalid={!!errors.cost}
                />
              )}
            />
          </FormField>
          {costLocked && (
            <p className="-mt-3 text-meta text-subtle-foreground">
              Este producto tiene stock: su costo se actualiza con las compras y ajustes de
              inventario.
            </p>
          )}

          <Controller
            control={control}
            name="pricingMode"
            render={({ field }) => (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-label font-medium">Cómo se calcula el precio</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ModeOption
                    checked={field.value === 'auto'}
                    onSelect={() => field.onChange('auto')}
                    title="Automático"
                    text="Costo más recargo, redondeado. Se actualiza si cambias el recargo."
                  />
                  <ModeOption
                    checked={field.value === 'manual'}
                    onSelect={() => {
                      // Precarga el precio actual para editarlo en lugar de empezar vacío.
                      if (getValues('manualPrice') === null && pricing) {
                        setValue('manualPrice', pricing.salePrice, { shouldDirty: true })
                      }
                      field.onChange('manual')
                    }}
                    title="Manual"
                    text="Tú fijas el precio. El sistema muestra el margen real."
                  />
                </div>
              </fieldset>
            )}
          />

          {v.pricingMode === 'manual' ? (
            <FormField id="manualPrice" label="Precio de venta" error={errors.manualPrice?.message}>
              <Controller
                control={control}
                name="manualPrice"
                render={({ field }) => (
                  <MoneyInput
                    id="manualPrice"
                    value={field.value ?? null}
                    onChange={field.onChange}
                    aria-invalid={!!errors.manualPrice}
                  />
                )}
              />
            </FormField>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField id="markupMode" label="Recargo">
                <NativeSelect id="markupMode" {...register('markupMode')}>
                  <option value="global">
                    General ({formatBp(settings.globalMarkupBp).replace(',0', '')})
                  </option>
                  <option value="custom">Propio de este producto</option>
                </NativeSelect>
              </FormField>
              {v.markupMode === 'custom' && (
                <FormField id="markupBp" label="Recargo propio" error={errors.markupBp?.message}>
                  <Controller
                    control={control}
                    name="markupBp"
                    render={({ field }) => (
                      <PercentInput
                        id="markupBp"
                        value={field.value === null ? null : bpToPercent(field.value)}
                        onChange={(pct) => field.onChange(pct === null ? null : percentToBp(pct))}
                        aria-invalid={!!errors.markupBp}
                      />
                    )}
                  />
                </FormField>
              )}
            </div>
          )}
        </Section>

        <Section title="Compra">
          <FormField id="supplierId" label="Proveedor habitual (opcional)">
            <NativeSelect id="supplierId" {...register('supplierId')}>
              <option value="">Sin proveedor habitual</option>
              {suppliers
                .filter((s) => s.active || s.id === product?.supplierId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </NativeSelect>
          </FormField>
          <p className="-mt-3 text-meta text-subtle-foreground">
            "Qué pedir" arma el pedido de este producto con este proveedor.
          </p>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              id="purchaseUnit"
              label="Se compra por (opcional)"
              error={errors.purchaseUnit?.message}
            >
              <Input
                id="purchaseUnit"
                placeholder="Canasta, paca, caja…"
                maxLength={30}
                {...register('purchaseUnit')}
              />
            </FormField>
            <FormField
              id="unitsPerPurchase"
              label="Unidades que trae"
              error={errors.unitsPerPurchase?.message}
            >
              <Controller
                control={control}
                name="unitsPerPurchase"
                render={({ field }) => (
                  <IntegerInput
                    id="unitsPerPurchase"
                    suffix="unid."
                    disabled={!v.purchaseUnit?.trim()}
                    value={field.value ?? null}
                    onChange={(n) => field.onChange(n)}
                  />
                )}
              />
            </FormField>
          </div>
          <p className="-mt-3 text-meta text-subtle-foreground">
            Ejemplo: canasta de 30. Al comprar puedes escribir canastas y la app suma las unidades.
            Déjalo vacío si se compra por unidad.
          </p>
        </Section>

        <Section title="Inventario">
          <FormField id="minStock" label="Stock mínimo" error={errors.minStock?.message}>
            <Controller
              control={control}
              name="minStock"
              render={({ field }) => (
                <IntegerInput
                  id="minStock"
                  suffix="unid."
                  value={field.value ?? null}
                  onChange={(n) => field.onChange(n ?? undefined)}
                />
              )}
            />
          </FormField>
          <p className="-mt-3 text-meta text-subtle-foreground">
            Al llegar a esta cantidad el producto aparece en alertas y recomendaciones de pedido.
          </p>
          {product && (
            <p className="text-label text-muted-foreground">
              Stock actual:{' '}
              <span className="tabular font-medium text-foreground">{product.stock}</span> (se
              gestiona en Inventario).
            </p>
          )}
        </Section>

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate('/productos')}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting || (!!product && !isDirty)}>
            {isSubmitting && <Loader2 aria-hidden className="animate-spin" />}
            {product ? 'Guardar cambios' : 'Crear producto'}
          </Button>
        </div>

        {product && (
          <>
            <PriceHistory productId={product.id} />
            <ActiveToggle uid={uid} product={product} />
          </>
        )}
      </div>

      <PricingSummary pricing={pricing} cost={typeof v.cost === 'number' ? v.cost : null} />
    </form>
  )
}

function ModeOption({
  checked,
  onSelect,
  title,
  text,
}: {
  checked: boolean
  onSelect: () => void
  title: string
  text: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={title}
      onClick={onSelect}
      className={cn(
        'flex cursor-pointer flex-col gap-1 rounded-lg border p-4 text-left transition-colors',
        checked
          ? 'border-primary bg-primary/10'
          : 'border-transparent bg-raised hover:border-border-strong',
      )}
    >
      <span className="flex items-center gap-2 font-semibold">
        <span
          aria-hidden
          className={cn(
            'grid size-4 place-items-center rounded-full border-2',
            checked ? 'border-primary' : 'border-border-strong',
          )}
        >
          {checked && <span className="size-1.5 rounded-full bg-primary" />}
        </span>
        {title}
      </span>
      <span className="text-meta text-muted-foreground">{text}</span>
    </button>
  )
}

/** Resumen en vivo: el precio final y su rentabilidad (F-01, F-02, ganancia). */
function PricingSummary({
  pricing,
  cost,
}: {
  pricing: ReturnType<typeof computePricing> | null
  cost: number | null
}) {
  return (
    <aside className="flex flex-col gap-5 rounded-xl border bg-card p-5 lg:sticky lg:top-8">
      <div>
        <p className="text-label text-muted-foreground">Precio de venta</p>
        <p className="tabular text-figure font-semibold tracking-tight">
          {pricing ? formatCop(pricing.salePrice) : '—'}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
        <Stat label="Costo" value={cost === null ? '—' : formatCop(cost)} />
        <Stat label="Ganancia por unidad" value={pricing ? formatCop(pricing.profit) : '—'} />
        <Stat
          label="Recargo sobre costo"
          value={pricing?.markup == null ? '—' : formatBp(pricing.markup)}
        />
        <Stat
          label="Margen sobre precio"
          value={pricing?.margin == null ? '—' : formatBp(pricing.margin)}
        />
      </dl>
      {pricing && (
        <p className="text-meta text-subtle-foreground">
          Precio sugerido con el recargo: {formatCop(pricing.suggested)}
        </p>
      )}
      {pricing?.warnings.map((w) => (
        <p key={w} className="flex gap-2 text-label text-warning">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {w}
        </p>
      ))}
    </aside>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="tabular font-semibold">{value}</dd>
    </div>
  )
}

const FIELD_LABEL: Record<PriceHistoryEntry['field'], string> = {
  salePrice: 'Precio de venta',
  avgCost: 'Costo',
  markupBp: 'Recargo propio',
}
const SOURCE_LABEL: Record<PriceHistoryEntry['source'], string> = {
  creacion: 'Creación',
  manual: 'Edición',
  recalculo: 'Recálculo',
  importacion: 'Importación',
}

function PriceHistory({ productId }: { productId: string }) {
  const { data = [], loading, error } = usePriceHistory(productId)
  const fmt = (e: PriceHistoryEntry, v: number | null) =>
    v === null ? '—' : e.field === 'markupBp' ? formatBp(v) : formatCop(v)
  return (
    <section className="flex flex-col gap-4">
      <h2 className="flex items-center gap-2 text-title font-semibold">
        <History aria-hidden className="size-5 text-muted-foreground" />
        Historial de precios
      </h2>
      <div className="rounded-xl border bg-card">
        {loading && <p className="px-5 py-4 text-muted-foreground">Cargando…</p>}
        {error && <p className="px-5 py-4 text-destructive">{error.message}</p>}
        {!loading && data.length === 0 && (
          <p className="px-5 py-4 text-muted-foreground">Sin cambios registrados.</p>
        )}
        <ul className="divide-y divide-border">
          {data.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 py-3"
            >
              <div>
                <p className="font-medium">{FIELD_LABEL[e.field]}</p>
                <p className="text-meta text-subtle-foreground">
                  {SOURCE_LABEL[e.source] ?? e.source}
                  {e.at ? `, ${formatDateTime(e.at)}` : ''}
                </p>
              </div>
              <p className="tabular">
                <span className="text-muted-foreground">{fmt(e, e.oldValue)}</span>
                <span className="mx-2 text-subtle-foreground">→</span>
                <span className="font-semibold">{fmt(e, e.newValue)}</span>
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function ActiveToggle({ uid, product }: { uid: string; product: Product }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-5">
      <div>
        <p className="font-semibold">{product.active ? 'Producto activo' : 'Producto inactivo'}</p>
        <p className="mt-1 max-w-prose text-label text-muted-foreground">
          {product.active
            ? 'Si lo desactivas, no aparecerá al vender, pero conserva su stock e historial.'
            : 'No aparece al vender. Actívalo para volver a venderlo.'}
        </p>
      </div>
      <Switch
        checked={product.active}
        aria-label={product.active ? 'Desactivar producto' : 'Activar producto'}
        onCheckedChange={(v) => (v ? void setProductActive(uid, product, true) : setOpen(true))}
      />
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Desactivar producto"
        destructive
        confirmLabel="Desactivar"
        description={`"${product.name}" dejará de aparecer al vender. Puedes activarlo de nuevo cuando quieras.`}
        onConfirm={async () => {
          await setProductActive(uid, product, false)
          toast.success('Producto desactivado')
        }}
      />
    </section>
  )
}
