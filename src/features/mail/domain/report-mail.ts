/**
 * Correo de reportes (Fase 10, M11). Lógica pura: decide el periodo de cada envío y arma el
 * mensaje (asunto, texto, HTML y CSV adjuntos) a partir de las mismas tablas de la Fase 9.
 * Sin credenciales: el envío real lo hace el script de `scripts/report-mail`.
 */
import {
  addBusinessDays,
  monthRangeOf,
  weekRangeOf,
  type BusinessDate,
  type BusinessDateRange,
} from '@/domain/dates'
import { formatCop } from '@/domain/money'
import { formatCell, periodLabel, type ReportTable } from '@/features/reports/domain/reports'

export type MailKind = 'semanal' | 'mensual'

export const MAIL_KIND_LABELS: Record<MailKind, string> = {
  semanal: 'Resumen semanal',
  mensual: 'Resumen mensual',
}

/**
 * Periodo que cubre cada envío. El semanal sale el lunes y cubre la semana anterior completa
 * (lunes a domingo). El mensual sale el día 1 y cubre el mes anterior completo.
 * `today` es la jornada en la que corre el envío.
 */
export function mailRange(kind: MailKind, today: BusinessDate): BusinessDateRange {
  const yesterday = addBusinessDays(today, -1)
  return kind === 'semanal' ? weekRangeOf(yesterday) : monthRangeOf(yesterday)
}

export interface MailAttachment {
  filename: string
  csv: string
}

export interface ReportMail {
  subject: string
  text: string
  html: string
  attachments: MailAttachment[]
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Fila de cifra clave: el valor de una fila del resumen financiero, o null si no existe. */
function figure(table: ReportTable | undefined, concepto: string): number | null {
  const row = table?.rows.find((r) => r.concepto === concepto)
  return typeof row?.valor === 'number' ? row.valor : null
}

/** Arma el correo. `tables` trae las tablas de la Fase 9 del periodo (por ID de reporte). */
export function buildReportMail(args: {
  kind: MailKind
  range: BusinessDateRange
  tables: ReportTable[]
  csvOf: (table: ReportTable) => string
  filenameOf: (table: ReportTable) => string
}): ReportMail {
  const { kind, range, tables } = args
  const byId = (id: string) => tables.find((t) => t.id === id)
  const resumen = byId('resumen_financiero')
  const ventas = byId(kind === 'semanal' ? 'ventas_semanales' : 'ventas_mensuales')
  const diarias = byId('ventas_diarias')
  const gastos = byId('gastos')
  const cierres = byId('cierres_caja')
  const compras = byId('compras_proveedor')

  const vendido = figure(resumen, 'Ventas')
  const utilidad = figure(resumen, 'Utilidad bruta')
  const operativa = figure(resumen, 'Utilidad operativa')
  const flujo = figure(resumen, 'Flujo neto de caja')
  const diferencias = (cierres?.rows ?? []).filter((r) => Number(r.diferencia ?? 0) !== 0).length
  const title = `${MAIL_KIND_LABELS[kind]} · ${range.from} a ${range.to}`
  const subject = `Kmilo Bar · ${title}`

  const figures: [string, string][] = [
    ['Vendido', vendido === null ? '—' : formatCop(vendido)],
    ['Utilidad bruta', utilidad === null ? '—' : formatCop(utilidad)],
    ['Utilidad operativa', operativa === null ? '—' : formatCop(operativa)],
    ['Flujo neto de caja', flujo === null ? '—' : formatCop(flujo)],
    ['Cierres de caja con diferencia', String(diferencias)],
  ]

  const resumenRows = (resumen?.rows ?? [])
    .map(
      (r) =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #ddd">${esc(String(r.concepto))}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #ddd;text-align:right">${esc(formatCell(r.valor, 'cop'))}</td></tr>`,
    )
    .join('')

  const html = [
    '<!doctype html><html lang="es"><body style="font-family:Arial,sans-serif;color:#111;max-width:640px">',
    `<h2 style="margin:0 0 4px">${esc(title)}</h2>`,
    `<p style="margin:0 0 16px;color:#555">${esc(periodLabel(range))} · Kmilo Bar</p>`,
    '<table style="border-collapse:collapse;width:100%;margin-bottom:20px">',
    ...figures.map(
      ([k, v]) =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #ddd">${esc(k)}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #ddd;text-align:right;font-weight:bold">${esc(v)}</td></tr>`,
    ),
    '</table>',
    '<h3 style="margin:0 0 8px">Resumen financiero</h3>',
    `<table style="border-collapse:collapse;width:100%;margin-bottom:20px">${resumenRows}</table>`,
    '<p style="color:#555;font-size:13px">Los detalles van en los archivos CSV adjuntos. Las cifras son las mismas que en la app (Reportes).</p>',
    '</body></html>',
  ].join('')

  const text = [
    title,
    '',
    ...figures.map(([k, v]) => `${k}: ${v}`),
    '',
    'Los detalles van en los archivos CSV adjuntos.',
  ].join('\n')

  const attached = [resumen, ventas ?? diarias, gastos, cierres, compras].filter(
    (t): t is ReportTable => t !== undefined,
  )
  return {
    subject,
    text,
    html,
    attachments: attached.map((t) => ({ filename: args.filenameOf(t), csv: args.csvOf(t) })),
  }
}
