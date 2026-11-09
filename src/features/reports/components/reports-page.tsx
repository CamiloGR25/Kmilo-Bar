import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, FileSpreadsheet, Loader2, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { Page, PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { businessDateOf, type BusinessDateRange } from '@/domain/dates'
import { cn } from '@/lib/utils'
import {
  buildReport,
  formatCell,
  rangeFor,
  REPORT_LABELS,
  validateCustomRange,
  type Preset,
  type ReportId,
  type ReportInput,
  type ReportTable,
  PRESETS,
} from '../domain/reports'
import { downloadCsv, downloadExcel } from '../services/export'
import { loadReportInput } from '../services/report-data'

const REPORT_GROUPS: { title: string; ids: ReportId[] }[] = [
  { title: 'Ventas', ids: ['ventas_diarias', 'ventas_semanales', 'ventas_mensuales'] },
  { title: 'Productos', ids: ['mas_vendidos', 'menos_vendidos', 'rentabilidad'] },
  { title: 'Inventario', ids: ['inventario_actual', 'movimientos_inventario'] },
  { title: 'Compras y gastos', ids: ['compras_proveedor', 'gastos'] },
  { title: 'Caja y finanzas', ids: ['cierres_caja', 'resumen_financiero'] },
]

const LOADING = { status: 'loading' } as const

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; input: ReportInput; generatedAt: string }

export function ReportsPage() {
  const [today] = useState(() => businessDateOf(new Date()))
  const [preset, setPreset] = useState<Preset>('mes')
  const [customFrom, setCustomFrom] = useState(today)
  const [customTo, setCustomTo] = useState(today)
  const [reportId, setReportId] = useState<ReportId>('ventas_diarias')
  const [busy, setBusy] = useState<'excel' | null>(null)
  // Al imprimir se monta una copia limpia del reporte fuera de la app (ver `print-root` en index.css).
  const [printing, setPrinting] = useState(false)
  useEffect(() => {
    if (!printing) return
    const id = window.setTimeout(() => {
      window.print()
      setPrinting(false)
    }, 50)
    return () => window.clearTimeout(id)
  }, [printing])

  const customError = preset === 'personal' ? validateCustomRange(customFrom, customTo) : null
  const range: BusinessDateRange | null =
    preset === 'personal'
      ? customError
        ? null
        : { from: customFrom, to: customTo }
      : rangeFor(preset, today)
  const rangeKey = range ? `${range.from}|${range.to}` : null

  // Último resultado y de qué periodo es. Si el periodo cambió, se muestra "leyendo" hasta que llegue.
  const [loaded, setLoaded] = useState<{ key: string; state: LoadState } | null>(null)
  const requestRef = useRef(0)
  useEffect(() => {
    if (!rangeKey) return
    const [from, to] = rangeKey.split('|') as [string, string]
    const request = ++requestRef.current
    loadReportInput({ from, to })
      .then((input) => {
        if (request !== requestRef.current) return
        setLoaded({
          key: rangeKey,
          state: { status: 'ready', input, generatedAt: new Date().toLocaleString('es-CO') },
        })
      })
      .catch(() => {
        if (request !== requestRef.current) return
        setLoaded({
          key: rangeKey,
          state: { status: 'error', message: 'No se pudieron leer los datos.' },
        })
      })
  }, [rangeKey])

  const load: LoadState = (loaded && loaded.key === rangeKey ? loaded.state : null) ?? LOADING

  const table: ReportTable | null = useMemo(() => {
    if (load.status !== 'ready') return null
    return buildReport(reportId, load.input)
  }, [load, reportId])

  async function onExcel() {
    if (!table) return
    setBusy('excel')
    try {
      await downloadExcel(table)
    } catch {
      toast.error('No se pudo crear el Excel. Inténtalo de nuevo.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Page wide>
      <PageHeader
        title="Reportes"
        description="Las mismas cifras de pantalla, para descargar en CSV o Excel, o imprimir como PDF."
      />

      <div className="no-print flex flex-col gap-4">
        <div role="group" aria-label="Periodo" className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.id}
              variant={preset === p.id ? 'default' : 'outline'}
              aria-pressed={preset === p.id}
              onClick={() => setPreset(p.id)}
              className="min-h-11"
            >
              {p.label}
            </Button>
          ))}
        </div>

        {preset === 'personal' && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-label">
              <span className="text-muted-foreground">Desde</span>
              <Input
                type="date"
                value={customFrom}
                max={today}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-11"
              />
            </label>
            <label className="flex flex-col gap-1 text-label">
              <span className="text-muted-foreground">Hasta</span>
              <Input
                type="date"
                value={customTo}
                max={today}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-11"
              />
            </label>
            {customError && <p className="text-label text-destructive">{customError}</p>}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <label className="flex flex-col gap-1 text-label lg:hidden">
            <span className="text-muted-foreground">Reporte</span>
            <select
              value={reportId}
              onChange={(e) => setReportId(e.target.value as ReportId)}
              className="h-11 rounded-lg border bg-card px-3"
            >
              {REPORT_GROUPS.map((g) => (
                <optgroup key={g.title} label={g.title}>
                  {g.ids.map((id) => (
                    <option key={id} value={id}>
                      {REPORT_LABELS[id]}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <nav aria-label="Reportes" className="hidden flex-col gap-4 lg:flex">
            {REPORT_GROUPS.map((g) => (
              <div key={g.title} className="flex flex-col gap-1">
                <p className="text-meta font-semibold text-muted-foreground">{g.title}</p>
                {g.ids.map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={reportId === id}
                    onClick={() => setReportId(id)}
                    className={cn(
                      'min-h-11 rounded-lg px-3 text-left text-label transition-colors',
                      reportId === id
                        ? 'bg-raised font-semibold text-foreground'
                        : 'text-muted-foreground hover:bg-raised/60 hover:text-foreground',
                    )}
                  >
                    {REPORT_LABELS[id]}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <section className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="min-h-11"
                disabled={!table}
                onClick={() => table && downloadCsv(table)}
              >
                <Download aria-hidden className="size-4" />
                CSV
              </Button>
              <Button
                variant="outline"
                className="min-h-11"
                disabled={!table || busy !== null}
                onClick={onExcel}
              >
                {busy === 'excel' ? (
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                ) : (
                  <FileSpreadsheet aria-hidden className="size-4" />
                )}
                Excel
              </Button>
              <Button
                variant="outline"
                className="min-h-11"
                disabled={!table}
                onClick={() => setPrinting(true)}
              >
                <Printer aria-hidden className="size-4" />
                PDF (imprimir)
              </Button>
            </div>

            {load.status === 'loading' && !customError && (
              <p className="flex items-center gap-2 text-label text-muted-foreground">
                <Loader2 aria-hidden className="size-4 animate-spin" /> Leyendo los datos…
              </p>
            )}
            {load.status === 'error' && (
              <p className="text-label text-destructive">{load.message}</p>
            )}

            {table && (
              <ReportView
                table={table}
                generatedAt={load.status === 'ready' ? load.generatedAt : ''}
              />
            )}
          </section>
        </div>
      </div>
      {printing &&
        table &&
        createPortal(
          <div className="print-root">
            <ReportView
              table={table}
              generatedAt={load.status === 'ready' ? load.generatedAt : ''}
            />
          </div>,
          document.body,
        )}
    </Page>
  )
}

/** Vista del reporte en pantalla y en impresión. */
export function ReportView({ table, generatedAt }: { table: ReportTable; generatedAt: string }) {
  return (
    <article className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h2 className="text-title font-semibold">{table.title}</h2>
        <p className="text-label text-muted-foreground">
          {table.period} · Kmilo Bar · Generado {generatedAt}
        </p>
        {table.note && <p className="text-label text-muted-foreground">{table.note}</p>}
      </header>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[32rem] tabular text-label">
          <thead className="bg-raised text-left">
            <tr>
              {table.columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn('px-3 py-2 font-semibold', c.kind !== 'text' && 'text-right')}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.length === 0 && (
              <tr>
                <td
                  colSpan={table.columns.length}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  Sin movimientos en este periodo.
                </td>
              </tr>
            )}
            {table.rows.map((row, i) => (
              <tr key={i} className="border-t">
                {table.columns.map((c) => (
                  <td key={c.key} className={cn('px-3 py-2', c.kind !== 'text' && 'text-right')}>
                    {formatCell(row[c.key], c.kind)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {table.totals && (
            <tfoot className="border-t-2 font-semibold">
              <tr>
                {table.columns.map((c) => (
                  <td key={c.key} className={cn('px-3 py-2', c.kind !== 'text' && 'text-right')}>
                    {formatCell(table.totals?.[c.key], c.kind)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </article>
  )
}
