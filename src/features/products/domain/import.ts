/**
 * Importación de productos desde CSV (F2-07).
 * Columnas (encabezados en español, sin importar mayúsculas ni tildes):
 *   nombre*, categoria*, costo*, unidad, stock_minimo, precio, recargo, descripcion
 * - precio: si viene, el producto queda con precio manual.
 * - recargo: porcentaje propio (ej. 60); vacío = recargo general.
 */
import { z } from 'zod'
import { parseCsv, toCsv } from '@/domain/csv'
import { parseCopInput, percentToBp } from '@/domain/money'
import { UNITS, type ProductDraft, type Unit } from './catalog'

export const IMPORT_COLUMNS = [
  'nombre',
  'categoria',
  'costo',
  'unidad',
  'stock_minimo',
  'precio',
  'recargo',
  'descripcion',
] as const

const REQUIRED = ['nombre', 'categoria', 'costo'] as const

export interface ImportRowResult {
  line: number
  draft: ProductDraft | null
  errors: string[]
}

export interface ImportResult {
  rows: ImportRowResult[]
  /** Errores del archivo completo (encabezados faltantes, vacío). */
  fileErrors: string[]
}

const intLike = (label: string) =>
  z.string().refine((v) => v === '' || /^\d+$/.test(v), `${label} debe ser un número entero`)

const rowSchema = z.object({
  nombre: z.string().min(1, 'Falta el nombre').max(80, 'El nombre supera 80 caracteres'),
  categoria: z.string().min(1, 'Falta la categoría'),
  costo: z.string().min(1, 'Falta el costo'),
  unidad: z.string(),
  stock_minimo: intLike('El stock mínimo'),
  precio: z.string(),
  recargo: z.string(),
  descripcion: z.string().max(300, 'La descripción supera 300 caracteres'),
})

export function parseProductCsv(text: string): ImportResult {
  const { headers, rows } = parseCsv(text)
  if (headers.length === 0) return { rows: [], fileErrors: ['El archivo está vacío.'] }
  const missing = REQUIRED.filter((c) => !headers.includes(c))
  if (missing.length > 0) {
    return { rows: [], fileErrors: [`Faltan columnas obligatorias: ${missing.join(', ')}.`] }
  }
  if (rows.length === 0)
    return { rows: [], fileErrors: ['El archivo no tiene filas de productos.'] }

  const seen = new Set<string>()
  const results = rows.map((raw, i): ImportRowResult => {
    const line = i + 2 // +1 por encabezado, +1 porque las líneas empiezan en 1
    const filled = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, raw[c] ?? '']))
    const parsed = rowSchema.safeParse(filled)
    const errors = parsed.success ? [] : parsed.error.issues.map((e) => e.message)

    const cost = parseCopInput(filled.costo ?? '')
    if (filled.costo && (cost === null || cost < 0)) errors.push('El costo no es un monto válido')

    const unitRaw = (filled.unidad ?? '').toLowerCase()
    const unit = (unitRaw === '' ? 'unidad' : unitRaw) as Unit
    if (!UNITS.includes(unit)) errors.push(`Unidad desconocida "${filled.unidad}"`)

    let manualPrice: number | null = null
    if (filled.precio) {
      manualPrice = parseCopInput(filled.precio)
      if (manualPrice === null || manualPrice < 0) errors.push('El precio no es un monto válido')
    }

    let markupBp: number | null = null
    if (filled.recargo) {
      const pct = Number(filled.recargo.replace('%', '').replace(',', '.').trim())
      if (!Number.isFinite(pct) || pct < 0 || pct > 1000) errors.push('El recargo no es válido')
      else markupBp = percentToBp(pct)
    }

    const key = (filled.nombre ?? '').trim().toLowerCase()
    if (key && seen.has(key)) errors.push('Producto repetido en el archivo')
    seen.add(key)

    if (errors.length > 0 || cost === null) return { line, draft: null, errors }
    return {
      line,
      errors: [],
      draft: {
        name: (filled.nombre ?? '').trim(),
        categoryName: (filled.categoria ?? '').trim(),
        description: (filled.descripcion ?? '').trim(),
        unit,
        cost,
        minStock: filled.stock_minimo ? Number(filled.stock_minimo) : 0,
        manualPrice,
        markupBp,
      },
    }
  })
  return { rows: results, fileErrors: [] }
}

/** Plantilla descargable con una fila de ejemplo. */
export function importTemplateCsv(): string {
  return toCsv(
    [...IMPORT_COLUMNS],
    [['Cerveza nacional 330 ml', 'Cervezas', 2400, 'botella', 24, '', '', 'Ejemplo']],
  )
}
