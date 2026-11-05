import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2, RefreshCcw } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { IntegerInput, NativeSelect, PercentInput } from '@/components/shared/inputs'
import { Page, PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { bpToPercent, formatCop, percentToBp } from '@/domain/money'
import { FormField } from '@/features/auth/components/form-field'
import { useAuth } from '@/features/auth/use-auth'
import {
  applySuggestedPrices,
  outdatedAutoPrices,
  useProducts,
} from '@/features/products/services/catalog-service'
import { CategoriesSection } from '@/features/products/components/categories-section'
import { ReviewSettingsSection } from '@/features/inventory/components/review-settings'
import { StatsRebuildSection } from '@/features/reports/components/stats-rebuild-section'
import {
  ROUNDING_STEPS,
  settingsFormSchema,
  type Settings,
  type SettingsFormValues,
} from '../domain/settings'
import { saveSettings, useSettings } from '../services/settings-service'

function toForm(s: Settings): SettingsFormValues {
  return {
    businessName: s.businessName,
    globalMarkupPercent: bpToPercent(s.globalMarkupBp),
    roundingStep: (ROUNDING_STEPS as readonly number[]).includes(s.roundingStep)
      ? (s.roundingStep as SettingsFormValues['roundingStep'])
      : 100,
    defaultMinStock: s.defaultMinStock,
    nearMinPercent: bpToPercent(s.nearMinFactorBp),
  }
}

export function SettingsPage() {
  const { user } = useAuth()
  const { data, loading, error } = useSettings()
  const products = useProducts()
  const settings = data?.settings

  return (
    <Page>
      <PageHeader
        title="Configuración"
        description="Datos del negocio, reglas de precio, revisión de inventario, categorías y estadísticas."
      />
      {error && (
        <p role="alert" className="text-destructive">
          No se pudo cargar la configuración: {error.message}
        </p>
      )}
      {loading || !settings ? (
        <p className="inline-flex items-center gap-2 text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Cargando…
        </p>
      ) : (
        <>
          <SettingsForm uid={user?.uid ?? ''} settings={settings} />
          <OutdatedPrices uid={user?.uid ?? ''} settings={settings} products={products.data} />
        </>
      )}
      <ReviewSettingsSection />
      <CategoriesSection />
      <StatsRebuildSection />
    </Page>
  )
}

function SettingsForm({ uid, settings }: { uid: string; settings: Settings }) {
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: toForm(settings),
  })

  // Si la configuración cambia desde otro dispositivo, refrescar el formulario.
  useEffect(() => reset(toForm(settings)), [settings, reset])

  const onSubmit = handleSubmit(async (v) => {
    const next: Settings = {
      ...settings,
      businessName: v.businessName.trim(),
      globalMarkupBp: percentToBp(v.globalMarkupPercent),
      roundingStep: v.roundingStep,
      defaultMinStock: v.defaultMinStock,
      nearMinFactorBp: percentToBp(v.nearMinPercent),
    }
    try {
      await saveSettings(uid, settings, next)
      toast.success('Configuración guardada')
    } catch (e) {
      toast.error(`No se pudo guardar: ${(e as Error).message}`)
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <Section title="Negocio">
        <FormField
          id="businessName"
          label="Nombre del negocio"
          error={errors.businessName?.message}
        >
          <Input
            id="businessName"
            {...register('businessName')}
            aria-invalid={!!errors.businessName}
          />
        </FormField>
      </Section>

      <Section
        title="Precios"
        description="El precio sugerido es el costo más el recargo, redondeado hacia arriba."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            id="globalMarkupPercent"
            label="Recargo general sobre el costo"
            error={errors.globalMarkupPercent?.message}
          >
            <Controller
              control={control}
              name="globalMarkupPercent"
              render={({ field }) => (
                <PercentInput
                  id="globalMarkupPercent"
                  value={field.value ?? null}
                  onChange={(v) => field.onChange(v ?? undefined)}
                  aria-invalid={!!errors.globalMarkupPercent}
                />
              )}
            />
          </FormField>
          <FormField id="roundingStep" label="Redondear hacia arriba a">
            <Controller
              control={control}
              name="roundingStep"
              render={({ field }) => (
                <NativeSelect
                  id="roundingStep"
                  value={field.value}
                  onChange={(e) => field.onChange(Number(e.target.value))}
                >
                  {ROUNDING_STEPS.map((s) => (
                    <option key={s} value={s}>
                      {formatCop(s)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            />
          </FormField>
        </div>
      </Section>

      <Section title="Inventario" description="Valores que usan las alertas de stock.">
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            id="defaultMinStock"
            label="Stock mínimo para productos nuevos"
            error={errors.defaultMinStock?.message}
          >
            <Controller
              control={control}
              name="defaultMinStock"
              render={({ field }) => (
                <IntegerInput
                  id="defaultMinStock"
                  suffix="unid."
                  value={field.value ?? null}
                  onChange={(v) => field.onChange(v ?? undefined)}
                />
              )}
            />
          </FormField>
          <FormField
            id="nearMinPercent"
            label="Avisar “cerca del mínimo” hasta"
            error={errors.nearMinPercent?.message}
          >
            <Controller
              control={control}
              name="nearMinPercent"
              render={({ field }) => (
                <PercentInput
                  id="nearMinPercent"
                  value={field.value ?? null}
                  onChange={(v) => field.onChange(v ?? undefined)}
                />
              )}
            />
          </FormField>
        </div>
        <p className="text-meta text-subtle-foreground">
          Con 150 %, un producto con mínimo 10 se marca “cerca del mínimo” desde 15 unidades.
        </p>
      </Section>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!isDirty || isSubmitting}
          onClick={() => reset(toForm(settings))}
        >
          Descartar
        </Button>
        <Button type="submit" disabled={!isDirty || isSubmitting}>
          {isSubmitting && <Loader2 aria-hidden className="animate-spin" />}
          Guardar cambios
        </Button>
      </div>
    </form>
  )
}

/** Avisa si hay productos con precio automático que ya no coinciden con el sugerido. */
function OutdatedPrices({
  uid,
  settings,
  products,
}: {
  uid: string
  settings: Settings
  products: Parameters<typeof outdatedAutoPrices>[0] | undefined
}) {
  const [open, setOpen] = useState(false)
  const changes = useMemo(
    () => (products ? outdatedAutoPrices(products, settings) : []),
    [products, settings],
  )
  if (changes.length === 0) return null

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/8 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-semibold">
          {changes.length === 1
            ? '1 producto automático tiene un precio distinto al sugerido'
            : `${changes.length} productos automáticos tienen un precio distinto al sugerido`}
        </p>
        <p className="mt-1 text-label text-muted-foreground">
          Pasa cuando cambias el recargo general o el redondeo.
        </p>
      </div>
      <Button onClick={() => setOpen(true)}>
        <RefreshCcw aria-hidden />
        Revisar y aplicar
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Aplicar precios sugeridos"
        confirmLabel={`Actualizar ${changes.length}`}
        description={
          <span className="flex flex-col gap-2">
            <span>Cada cambio queda en el historial de precios del producto.</span>
            <span className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg bg-raised p-3">
              {changes.map(({ product, suggested }) => (
                <span key={product.id} className="flex justify-between gap-4 text-foreground">
                  <span className="truncate">{product.name}</span>
                  <span className="shrink-0 tabular">
                    {formatCop(product.salePrice)} → {formatCop(suggested)}
                  </span>
                </span>
              ))}
            </span>
          </span>
        }
        onConfirm={async () => {
          await applySuggestedPrices(uid, changes)
          toast.success('Precios actualizados')
        }}
      />
    </section>
  )
}

export function Section({
  title,
  description,
  children,
  actions,
}: {
  title: string
  description?: string
  children: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-title font-semibold">{title}</h2>
          {description && <p className="mt-1 text-label text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="flex flex-col gap-5 rounded-xl border bg-card p-5">{children}</div>
    </section>
  )
}
