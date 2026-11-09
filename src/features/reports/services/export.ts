/**
 * Exportación de reportes (Fase 9, F9-02 CSV y Excel, F9-03 PDF). Todo sale de la misma tabla
 * del motor (`domain/reports.ts`), así que lo exportado coincide con la pantalla.
 * El PDF se genera con la vista de impresión del navegador ("Guardar como PDF"): sin librerías.
 * ExcelJS se carga solo al exportar a Excel, para no pesar en la carga inicial.
 */
import type { Cell, ColumnKind, ReportTable } from '../domain/reports'

/** Número con formato colombiano: 31,2 para porcentajes, sin separadores para cifras de CSV. */
function csvNumber(value: number, kind: ColumnKind): string {
  if (kind === 'pct') return value.toFixed(1).replace('.', ',')
  return String(value)
}

function csvCell(value: Cell, kind: ColumnKind): string {
  if (value === null) return ''
  const text = typeof value === 'number' ? csvNumber(value, kind) : value
  // Separador ";" (Excel en español): se entrecomilla si la celda trae ";", comillas o saltos.
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** CSV del reporte: encabezados, filas y total. Separador ";" y BOM para que Excel lo abra bien. */
export function reportToCsv(table: ReportTable): string {
  const head = table.columns.map((c) => csvCell(c.label, 'text')).join(';')
  const body = table.rows.map((row) =>
    table.columns.map((c) => csvCell(row[c.key] ?? null, c.kind)).join(';'),
  )
  const lines = [head, ...body]
  if (table.totals) {
    lines.push(table.columns.map((c) => csvCell(table.totals?.[c.key] ?? null, c.kind)).join(';'))
  }
  return `﻿${lines.join('\r\n')}\r\n`
}

/** Nombre de archivo seguro: reporte y periodo, sin espacios ni tildes. */
export function fileNameFor(table: ReportTable, ext: 'csv' | 'xlsx'): string {
  const slug = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  return `${slug(table.id)}-${slug(table.period)}.${ext}`
}

/** Descarga un archivo desde el navegador. */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Se libera después de que el navegador empiece la descarga.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadCsv(table: ReportTable) {
  const blob = new Blob([reportToCsv(table)], { type: 'text/csv;charset=utf-8' })
  downloadBlob(blob, fileNameFor(table, 'csv'))
}

const NUM_FORMAT: Record<ColumnKind, string | null> = {
  text: null,
  cop: '#,##0',
  int: '#,##0',
  pct: '0.0"%"',
}

/** Libro de Excel (.xlsx) del reporte, con formato de pesos y porcentajes. ExcelJS se carga solo aquí. */
export async function excelBuffer(table: ReportTable): Promise<ArrayBuffer> {
  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Kmilo Bar'
  wb.created = new Date()
  const ws = wb.addWorksheet(table.title.slice(0, 31))

  ws.addRow([table.title]).font = { bold: true, size: 14 }
  ws.addRow([table.period])
  if (table.note) ws.addRow([table.note]).font = { italic: true, color: { argb: 'FF666666' } }
  ws.addRow([])

  const header = ws.addRow(table.columns.map((c) => c.label))
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }

  const addDataRow = (values: Cell[], bold: boolean) => {
    const row = ws.addRow(values)
    table.columns.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      const fmt = NUM_FORMAT[c.kind]
      if (fmt && typeof values[i] === 'number') cell.numFmt = fmt
      if (bold) cell.font = { bold: true }
    })
  }
  for (const r of table.rows)
    addDataRow(
      table.columns.map((c) => r[c.key] ?? null),
      false,
    )
  if (table.totals)
    addDataRow(
      table.columns.map((c) => table.totals?.[c.key] ?? null),
      true,
    )

  ws.columns = table.columns.map((c) => ({
    width: c.kind === 'text' ? 28 : 16,
  }))
  ws.views = [{ state: 'frozen', ySplit: header.number }]

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

export async function downloadExcel(table: ReportTable) {
  const buffer = await excelBuffer(table)
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  downloadBlob(blob, fileNameFor(table, 'xlsx'))
}
