import { useMemo, useRef, useState } from 'react'
import { CheckCircle2, Download, FileUp, Loader2, XCircle } from 'lucide-react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { computePricing } from '@/domain/metrics/pricing'
import { formatCop } from '@/domain/money'
import { useAuth } from '@/features/auth/use-auth'
import { useSettings } from '@/features/settings/services/settings-service'
import { cn } from '@/lib/utils'
import {
  IMPORT_COLUMNS,
  importTemplateCsv,
  parseProductCsv,
  type ImportResult,
} from '../domain/import'
import { importProducts, useCategories, useProducts } from '../services/catalog-service'

/** Descarga un texto como archivo (se genera en el navegador, no sale a internet). */
function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}

export function ImportPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const settings = useSettings()
  const categories = useCategories()
  const products = useProducts()
  const fileInput = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [pending, setPending] = useState(false)

  const existing = useMemo(
    () => new Set((products.data ?? []).map((p) => p.name.trim().toLowerCase())),
    [products.data],
  )
  const valid = result?.rows.filter((r) => r.draft) ?? []
  const toCreate = valid.filter((r) => !existing.has(r.draft!.name.toLowerCase()))
  const invalid = result?.rows.filter((r) => !r.draft) ?? []
  const knownCategories = new Set((categories.data ?? []).map((c) => c.name.toLowerCase()))
  const newCategories = [
    ...new Set(
      toCreate
        .map((r) => r.draft!.categoryName)
        .filter((n) => !knownCategories.has(n.toLowerCase())),
    ),
  ]

  async function onFile(file: File | undefined) {
    if (!file) return
    if (file.size > 1_000_000) {
      toast.error('El archivo supera 1 MB.')
      return
    }
    setFileName(file.name)
    setResult(parseProductCsv(await file.text()))
  }

  return (
    <Page wide>
      <PageHeader
        title="Importar productos"
        description="Carga tu catálogo desde un archivo CSV (puedes exportarlo desde Excel)."
        back={{ to: '/productos', label: 'Productos' }}
      />

      <section className="flex flex-col gap-4 rounded-xl border bg-card p-5">
        <div>
          <h2 className="text-title font-semibold">1. Prepara el archivo</h2>
          <p className="mt-1 max-w-prose text-label text-muted-foreground">
            Columnas: <span className="text-foreground">{IMPORT_COLUMNS.join(', ')}</span>. Son
            obligatorias nombre, categoria y costo. Si escribes un precio, ese producto queda con
            precio manual; si no, se calcula con el recargo.
          </p>
        </div>
        <Button
          variant="outline"
          className="w-fit"
          onClick={() => downloadText('plantilla-productos.csv', importTemplateCsv())}
        >
          <Download aria-hidden />
          Descargar plantilla
        </Button>
      </section>

      <section className="flex flex-col gap-4 rounded-xl border bg-card p-5">
        <h2 className="text-title font-semibold">2. Elige el archivo</h2>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          aria-label="Archivo CSV"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            void onFile(e.dataTransfer.files[0])
          }}
          className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong px-6 py-10 text-center transition-colors hover:bg-raised/50"
        >
          <FileUp aria-hidden className="size-8 text-primary-text" />
          <span className="font-medium">{fileName ?? 'Toca para elegir un archivo .csv'}</span>
          <span className="text-meta text-subtle-foreground">o arrástralo aquí</span>
        </button>
      </section>

      {result && (
        <section className="flex flex-col gap-4">
          <h2 className="text-title font-semibold">3. Revisa y confirma</h2>

          {result.fileErrors.map((e) => (
            <p key={e} role="alert" className="text-destructive">
              {e}
            </p>
          ))}

          {result.rows.length > 0 && (
            <>
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <Summary tone="ok" text={`${toCreate.length} listos para importar`} />
                {valid.length - toCreate.length > 0 && (
                  <Summary
                    tone="muted"
                    text={`${valid.length - toCreate.length} ya existen (se omiten)`}
                  />
                )}
                {invalid.length > 0 && (
                  <Summary tone="error" text={`${invalid.length} con errores`} />
                )}
              </div>
              {newCategories.length > 0 && (
                <p className="text-label text-muted-foreground">
                  Se crearán categorías nuevas: {newCategories.join(', ')}.
                </p>
              )}

              <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto rounded-xl border bg-card">
                {result.rows.map((r) => {
                  const skip = r.draft && existing.has(r.draft.name.toLowerCase())
                  const price =
                    r.draft && settings.data
                      ? computePricing(
                          {
                            cost: r.draft.cost,
                            pricingMode: r.draft.manualPrice !== null ? 'manual' : 'auto',
                            markupBp: r.draft.markupBp,
                            manualPrice: r.draft.manualPrice,
                          },
                          settings.data.settings,
                        ).salePrice
                      : null
                  return (
                    <li key={r.line} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                      <span className="w-12 shrink-0 pt-0.5 tabular text-meta text-subtle-foreground">
                        Fila {r.line}
                      </span>
                      <div className="min-w-0 flex-1">
                        {r.draft ? (
                          <>
                            <p className={cn('font-medium', skip && 'text-muted-foreground')}>
                              {r.draft.name}
                            </p>
                            <p className="text-meta text-subtle-foreground">
                              {r.draft.categoryName}, {r.draft.unit}, costo{' '}
                              {formatCop(r.draft.cost)}
                              {price !== null && `, precio ${formatCop(price)}`}
                              {skip && ', ya existe'}
                            </p>
                          </>
                        ) : (
                          <ul className="text-label text-destructive">
                            {r.errors.map((e) => (
                              <li key={e}>{e}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>

              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setResult(null)
                    setFileName(null)
                    if (fileInput.current) fileInput.current.value = ''
                  }}
                >
                  Elegir otro archivo
                </Button>
                <Button
                  disabled={toCreate.length === 0 || pending || !settings.data}
                  onClick={async () => {
                    if (!settings.data) return
                    setPending(true)
                    try {
                      const r = await importProducts(
                        user?.uid ?? '',
                        toCreate.map((x) => x.draft!),
                        categories.data ?? [],
                        products.data ?? [],
                        settings.data.settings,
                        'csv',
                      )
                      toast.success(`${r.created} productos importados`)
                      navigate('/productos')
                    } catch (e) {
                      toast.error(`No se pudo importar: ${(e as Error).message}`)
                    } finally {
                      setPending(false)
                    }
                  }}
                >
                  {pending && <Loader2 aria-hidden className="animate-spin" />}
                  Importar {toCreate.length} {toCreate.length === 1 ? 'producto' : 'productos'}
                </Button>
              </div>
            </>
          )}
        </section>
      )}
    </Page>
  )
}

function Summary({ tone, text }: { tone: 'ok' | 'error' | 'muted'; text: string }) {
  const Icon = tone === 'error' ? XCircle : CheckCircle2
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 text-label font-medium',
        tone === 'ok' && 'text-success',
        tone === 'error' && 'text-destructive',
        tone === 'muted' && 'text-muted-foreground',
      )}
    >
      <Icon aria-hidden className="size-4" />
      {text}
    </span>
  )
}
