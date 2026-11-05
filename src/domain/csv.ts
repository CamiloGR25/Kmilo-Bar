/**
 * Lectura y escritura de CSV (RFC 4180 básico), sin dependencias.
 * Acepta separador "," o ";" (Excel en español suele exportar con ";").
 */

export type CsvRow = Record<string, string>

/** Detecta el separador mirando la primera línea. */
export function detectDelimiter(text: string): ',' | ';' {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const commas = (firstLine.match(/,/g) ?? []).length
  const semicolons = (firstLine.match(/;/g) ?? []).length
  return semicolons > commas ? ';' : ','
}

/** Divide el texto en filas y celdas respetando comillas dobles. */
export function parseCsvRows(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  const src = text.replace(/^﻿/, '') // BOM de Excel

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else inQuotes = false
      } else cell += ch
      continue
    }
    if (ch === '"') inQuotes = true
    else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** Normaliza un encabezado: minúsculas, sin tildes ni espacios extra ("Stock mínimo" → "stock_minimo"). */
export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

/** Convierte el CSV en objetos usando la primera fila como encabezados normalizados. */
export function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const [headerRow, ...dataRows] = parseCsvRows(text)
  if (!headerRow) return { headers: [], rows: [] }
  const headers = headerRow.map(normalizeHeader)
  const rows = dataRows.map((cells) =>
    Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? '').trim()])),
  )
  return { headers, rows }
}

/** Genera CSV con ";" (se abre bien en Excel en español) y BOM UTF-8. */
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const escape = (v: string | number) => {
    const s = String(v)
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers, ...rows].map((r) => r.map(escape).join(';'))
  return `﻿${lines.join('\r\n')}\r\n`
}
