/**
 * Motor de reportes (Fase 9, F9-01). Lógica pura: convierte los datos de un periodo en tablas
 * con columnas, filas y total. La misma tabla alimenta la pantalla, el CSV, el Excel y el PDF,
 * así que las cifras exportadas son iguales a las de pantalla (criterio de aceptación de la fase).
 * Reutiliza las fórmulas de `domain/metrics` y `features/finance/domain` (sin recalcular).
 */
import {
  addBusinessDays,
  isBusinessDate,
  monthRangeOf,
  weekRangeOf,
  type BusinessDate,
  type BusinessDateRange,
} from '@/domain/dates'
import { formatCop } from '@/domain/money'
import { mergeDeltas, type DailyStatsDelta, type ProductStats } from '@/domain/metrics/daily-stats'
import {
  cashFlow,
  EXPENSE_KIND_LABELS,
  incomeStatement,
  type ExpenseKind,
} from '@/features/finance/domain/finance'
import { MOVEMENT_LABELS } from '@/features/inventory/domain/movements'

// ---------------------------------------------------------------------------
// Catálogo de reportes (M10, 12 reportes)
// ---------------------------------------------------------------------------

export const REPORT_IDS = [
  'ventas_diarias',
  'ventas_semanales',
  'ventas_mensuales',
  'inventario_actual',
  'movimientos_inventario',
  'mas_vendidos',
  'menos_vendidos',
  'gastos',
  'compras_proveedor',
  'rentabilidad',
  'cierres_caja',
  'resumen_financiero',
] as const

export type ReportId = (typeof REPORT_IDS)[number]

export const REPORT_LABELS: Record<ReportId, string> = {
  ventas_diarias: 'Ventas diarias',
  ventas_semanales: 'Ventas semanales',
  ventas_mensuales: 'Ventas mensuales',
  inventario_actual: 'Inventario actual',
  movimientos_inventario: 'Movimientos de inventario',
  mas_vendidos: 'Productos más vendidos',
  menos_vendidos: 'Productos menos vendidos',
  gastos: 'Gastos',
  compras_proveedor: 'Compras por proveedor',
  rentabilidad: 'Rentabilidad por producto',
  cierres_caja: 'Cierres de caja',
  resumen_financiero: 'Resumen financiero',
}

/** Reportes que dependen del inventario actual (no del periodo). */
export const PERIOD_FREE_REPORTS: readonly ReportId[] = ['inventario_actual']

// ---------------------------------------------------------------------------
// Tabla de salida
// ---------------------------------------------------------------------------

/** cop: pesos enteros; int: cantidad; pct: porcentaje (31,2 = 31,2 %); text: texto. */
export type ColumnKind = 'text' | 'cop' | 'int' | 'pct'

export interface Column {
  key: string
  label: string
  kind: ColumnKind
}

export type Cell = string | number | null

export interface ReportTable {
  id: ReportId
  title: string
  /** Periodo legible, p. ej. "del 2026-11-01 al 2026-11-09". */
  period: string
  columns: Column[]
  rows: Record<string, Cell>[]
  /** Fila de totales (solo columnas numéricas que se suman). */
  totals: Record<string, Cell> | null
  note: string | null
}

// ---------------------------------------------------------------------------
// Datos de entrada (los llena el servicio desde Firestore)
// ---------------------------------------------------------------------------

export interface DayRecord extends DailyStatsDelta {
  businessDate: BusinessDate
}

export interface ProductRecord {
  id: string
  name: string
  categoryId: string
  categoryName: string
  stock: number
  minStock: number
  avgCost: number
  salePrice: number
  active: boolean
}

export interface MovementRecord {
  businessDate: BusinessDate
  productName: string
  type: string
  qty: number
  stockBefore: number
  stockAfter: number
  unitCost: number
  reason: string | null
  createdAtMs: number
}

export interface ExpenseRecord {
  businessDate: BusinessDate
  categoryName: string
  kind: ExpenseKind
  amount: number
  method: 'efectivo' | 'transferencia'
  fromCash: boolean
  description: string
}

export interface ReceptionRecord {
  supplierId: string
  businessDate: BusinessDate
  total: number
}

export interface SupplierPaymentRecord {
  supplierId: string
  businessDate: BusinessDate
  amount: number
}

export interface SupplierRecord {
  id: string
  name: string
}

export interface SessionRecord {
  businessDate: BusinessDate
  number: number
  openingBalance: number
  status: 'abierta' | 'cerrada'
  sales: number
  expectedCash: number | null
  countedCash: number | null
  difference: number | null
  differenceReason: string | null
}

export interface ReportInput {
  range: BusinessDateRange
  days: DayRecord[]
  products: ProductRecord[]
  movements: MovementRecord[]
  expenses: ExpenseRecord[]
  receptions: ReceptionRecord[]
  supplierPayments: SupplierPaymentRecord[]
  suppliers: SupplierRecord[]
  sessions: SessionRecord[]
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Lista de jornadas (inclusive) entre dos fechas. */
export function dayList(range: BusinessDateRange): BusinessDate[] {
  const out: BusinessDate[] = []
  for (let d = range.from; d <= range.to; d = addBusinessDays(d, 1)) out.push(d)
  return out
}

/** Periodo legible. */
export function periodLabel(range: BusinessDateRange): string {
  return range.from === range.to ? `Jornada ${range.from}` : `del ${range.from} al ${range.to}`
}

/** Porcentaje (0-100) con un decimal; null si no hay base. */
export function percent(part: number, whole: number): number | null {
  if (whole <= 0) return null
  return Math.round((part / whole) * 1000) / 10
}

function sumOf<T extends Record<string, Cell>>(rows: readonly T[], keys: readonly string[]) {
  const totals: Record<string, number> = {}
  for (const k of keys) {
    totals[k] = rows.reduce((s, r) => s + (typeof r[k] === 'number' ? (r[k] as number) : 0), 0)
  }
  return totals
}

/** Agrupa las jornadas por clave (semana, mes o día) y suma sus estadísticas. */
function groupDays(days: readonly DayRecord[], keyOf: (d: BusinessDate) => string) {
  const map = new Map<string, DayRecord[]>()
  for (const d of days) {
    const k = keyOf(d.businessDate)
    map.set(k, [...(map.get(k) ?? []), d])
  }
  return map
}

const salesColumns: Column[] = [
  { key: 'cuentas', label: 'Cuentas', kind: 'int' },
  { key: 'vendido', label: 'Vendido', kind: 'cop' },
  { key: 'cobrado', label: 'Cobrado', kind: 'cop' },
  { key: 'costo', label: 'Costo', kind: 'cop' },
  { key: 'utilidad', label: 'Utilidad bruta', kind: 'cop' },
  { key: 'perdidas', label: 'Pérdidas', kind: 'cop' },
]

function salesRow(label: string, t: DailyStatsDelta): Record<string, Cell> {
  const sales = t.salesGross ?? 0
  const cogs = t.cogs ?? 0
  return {
    cuentas: t.ordersCount ?? 0,
    vendido: sales,
    cobrado: t.collected ?? 0,
    costo: cogs,
    utilidad: sales - cogs,
    perdidas: (t.orderLosses ?? 0) + (t.invLosses ?? 0),
    periodo: label,
  }
}

function salesTable(
  id: ReportId,
  title: string,
  periodName: string,
  rows: Record<string, Cell>[],
  firstColumn: string,
): ReportTable {
  const keys = salesColumns.map((c) => c.key)
  return {
    id,
    title,
    period: periodName,
    columns: [{ key: 'periodo', label: firstColumn, kind: 'text' }, ...salesColumns],
    rows,
    totals: { periodo: 'Total', ...sumOf(rows, keys) },
    note: null,
  }
}

// ---------------------------------------------------------------------------
// Ventas por jornada, semana y mes (F9-01)
// ---------------------------------------------------------------------------

function ventasDiarias(input: ReportInput, period: string): ReportTable {
  const byDay = new Map(input.days.map((d) => [d.businessDate, d]))
  const rows = dayList(input.range).map((day) => salesRow(day, byDay.get(day) ?? {}))
  return salesTable('ventas_diarias', REPORT_LABELS.ventas_diarias, period, rows, 'Jornada')
}

function ventasSemanales(input: ReportInput, period: string): ReportTable {
  const groups = groupDays(input.days, (d) => weekRangeOf(d).from)
  const starts = [...new Set(dayList(input.range).map((d) => weekRangeOf(d).from))]
  const rows = starts.map((from) =>
    salesRow(`${from} a ${weekRangeOf(from).to}`, mergeDeltas(...(groups.get(from) ?? []))),
  )
  return salesTable('ventas_semanales', REPORT_LABELS.ventas_semanales, period, rows, 'Semana')
}

function ventasMensuales(input: ReportInput, period: string): ReportTable {
  const groups = groupDays(input.days, (d) => d.slice(0, 7))
  const months = [...new Set(dayList(input.range).map((d) => d.slice(0, 7)))]
  const rows = months.map((m) => salesRow(m, mergeDeltas(...(groups.get(m) ?? []))))
  return salesTable('ventas_mensuales', REPORT_LABELS.ventas_mensuales, period, rows, 'Mes')
}

// ---------------------------------------------------------------------------
// Inventario
// ---------------------------------------------------------------------------

function inventarioActual(input: ReportInput): ReportTable {
  const active = input.products.filter((p) => p.active)
  const rows = active
    .map((p) => ({
      producto: p.name,
      categoria: p.categoryName,
      stock: p.stock,
      minimo: p.minStock,
      costoPromedio: p.avgCost,
      valorCosto: p.stock * p.avgCost,
      precio: p.salePrice,
      valorVenta: p.stock * p.salePrice,
    }))
    .sort((a, b) => a.categoria.localeCompare(b.categoria) || a.producto.localeCompare(b.producto))
  return {
    id: 'inventario_actual',
    title: REPORT_LABELS.inventario_actual,
    period: 'Estado al momento de generar el reporte',
    columns: [
      { key: 'producto', label: 'Producto', kind: 'text' },
      { key: 'categoria', label: 'Categoría', kind: 'text' },
      { key: 'stock', label: 'Stock', kind: 'int' },
      { key: 'minimo', label: 'Mínimo', kind: 'int' },
      { key: 'costoPromedio', label: 'Costo promedio', kind: 'cop' },
      { key: 'valorCosto', label: 'Valor a costo', kind: 'cop' },
      { key: 'precio', label: 'Precio de venta', kind: 'cop' },
      { key: 'valorVenta', label: 'Valor a venta', kind: 'cop' },
    ],
    rows,
    totals: { producto: 'Total', ...sumOf(rows, ['valorCosto', 'valorVenta']) },
    note: 'Se excluyen los productos desactivados.',
  }
}

function movimientosInventario(input: ReportInput, period: string): ReportTable {
  const rows = [...input.movements]
    .sort((a, b) => a.createdAtMs - b.createdAtMs)
    .map((m) => ({
      fecha: m.businessDate,
      producto: m.productName,
      tipo: MOVEMENT_LABELS[m.type as keyof typeof MOVEMENT_LABELS] ?? m.type,
      cantidad: m.qty,
      stockAntes: m.stockBefore,
      stockDespues: m.stockAfter,
      costoUnitario: m.unitCost,
      motivo: m.reason ?? '',
    }))
  return {
    id: 'movimientos_inventario',
    title: REPORT_LABELS.movimientos_inventario,
    period,
    columns: [
      { key: 'fecha', label: 'Jornada', kind: 'text' },
      { key: 'producto', label: 'Producto', kind: 'text' },
      { key: 'tipo', label: 'Tipo', kind: 'text' },
      { key: 'cantidad', label: 'Cantidad', kind: 'int' },
      { key: 'stockAntes', label: 'Stock antes', kind: 'int' },
      { key: 'stockDespues', label: 'Stock después', kind: 'int' },
      { key: 'costoUnitario', label: 'Costo unitario', kind: 'cop' },
      { key: 'motivo', label: 'Motivo', kind: 'text' },
    ],
    rows,
    totals: null,
    note: null,
  }
}

// ---------------------------------------------------------------------------
// Productos vendidos y rentabilidad (F9-01)
// ---------------------------------------------------------------------------

interface ProductSales {
  id: string
  name: string
  categoria: string
  cantidad: number
  ventas: number
  costo: number
  utilidad: number
  margen: number | null
}

/** Ventas por producto del periodo, a partir de `byProduct` de cada jornada. */
export function productSales(days: readonly DayRecord[], categoryNames: Map<string, string>) {
  const acc = new Map<string, ProductStats>()
  for (const d of days) {
    for (const [id, p] of Object.entries(d.byProduct ?? {})) {
      const prev = acc.get(id)
      acc.set(id, {
        name: p.name,
        categoryId: p.categoryId,
        qty: (prev?.qty ?? 0) + p.qty,
        sales: (prev?.sales ?? 0) + p.sales,
        cogs: (prev?.cogs ?? 0) + p.cogs,
      })
    }
  }
  return [...acc.entries()].map(([id, p]): ProductSales => {
    const utilidad = p.sales - p.cogs
    return {
      id,
      name: p.name,
      categoria: categoryNames.get(p.categoryId) ?? p.categoryId,
      cantidad: p.qty,
      ventas: p.sales,
      costo: p.cogs,
      utilidad,
      margen: percent(utilidad, p.sales),
    }
  })
}

const productColumns: Column[] = [
  { key: 'producto', label: 'Producto', kind: 'text' },
  { key: 'categoria', label: 'Categoría', kind: 'text' },
  { key: 'cantidad', label: 'Cantidad', kind: 'int' },
  { key: 'ventas', label: 'Ventas', kind: 'cop' },
  { key: 'costo', label: 'Costo', kind: 'cop' },
  { key: 'utilidad', label: 'Utilidad', kind: 'cop' },
  { key: 'margen', label: 'Margen', kind: 'pct' },
]

function productTable(
  id: ReportId,
  rows: ProductSales[],
  period: string,
  note: string | null,
): ReportTable {
  const out = rows.map((r) => ({
    producto: r.name,
    categoria: r.categoria,
    cantidad: r.cantidad,
    ventas: r.ventas,
    costo: r.costo,
    utilidad: r.utilidad,
    margen: r.margen,
  }))
  return {
    id,
    title: REPORT_LABELS[id],
    period,
    columns: productColumns,
    rows: out,
    totals: {
      producto: 'Total',
      cantidad: sumOf(out, ['cantidad'])['cantidad'] ?? 0,
      ventas: sumOf(out, ['ventas'])['ventas'] ?? 0,
      costo: sumOf(out, ['costo'])['costo'] ?? 0,
      utilidad: sumOf(out, ['utilidad'])['utilidad'] ?? 0,
      margen: percent(
        out.reduce((s, r) => s + (r.utilidad as number), 0),
        out.reduce((s, r) => s + (r.ventas as number), 0),
      ),
    },
    note,
  }
}

function masVendidos(sales: ProductSales[], period: string): ReportTable {
  const rows = [...sales].sort((a, b) => b.cantidad - a.cantidad || b.ventas - a.ventas)
  return productTable('mas_vendidos', rows, period, 'Ordenado de mayor a menor cantidad.')
}

function menosVendidos(sales: ProductSales[], period: string): ReportTable {
  const rows = [...sales].sort((a, b) => a.cantidad - b.cantidad || a.ventas - b.ventas)
  return productTable(
    'menos_vendidos',
    rows,
    period,
    'Ordenado de menor a mayor cantidad. Los productos sin ventas en el periodo no aparecen.',
  )
}

function rentabilidad(sales: ProductSales[], period: string): ReportTable {
  const rows = [...sales].sort((a, b) => b.utilidad - a.utilidad)
  return productTable(
    'rentabilidad',
    rows,
    period,
    'Utilidad bruta = ventas − costo de lo vendido (costo promedio del momento de la venta).',
  )
}

// ---------------------------------------------------------------------------
// Gastos, compras y caja (F9-01)
// ---------------------------------------------------------------------------

function gastos(input: ReportInput, period: string): ReportTable {
  const rows = [...input.expenses]
    .sort((a, b) => b.businessDate.localeCompare(a.businessDate))
    .map((e) => ({
      fecha: e.businessDate,
      categoria: e.categoryName,
      tipo: EXPENSE_KIND_LABELS[e.kind],
      pago: e.fromCash
        ? 'De la caja'
        : e.method === 'efectivo'
          ? 'Efectivo, por fuera'
          : 'Transferencia',
      monto: e.amount,
      descripcion: e.description,
    }))
  return {
    id: 'gastos',
    title: REPORT_LABELS.gastos,
    period,
    columns: [
      { key: 'fecha', label: 'Jornada', kind: 'text' },
      { key: 'categoria', label: 'Categoría', kind: 'text' },
      { key: 'tipo', label: 'Tipo', kind: 'text' },
      { key: 'pago', label: 'Pago', kind: 'text' },
      { key: 'monto', label: 'Monto', kind: 'cop' },
      { key: 'descripcion', label: 'Descripción', kind: 'text' },
    ],
    rows,
    totals: { fecha: 'Total', monto: sumOf(rows, ['monto'])['monto'] ?? 0 },
    note: 'No incluye gastos anulados. Las compras de mercancía van en "Compras por proveedor".',
  }
}

function comprasProveedor(input: ReportInput, period: string): ReportTable {
  const names = new Map(input.suppliers.map((s) => [s.id, s.name]))
  const ids = new Set([
    ...input.receptions.map((r) => r.supplierId),
    ...input.supplierPayments.map((p) => p.supplierId),
  ])
  const rows = [...ids]
    .map((id) => ({
      proveedor: names.get(id) ?? 'Proveedor eliminado',
      recibido: input.receptions
        .filter((r) => r.supplierId === id)
        .reduce((s, r) => s + r.total, 0),
      pagado: input.supplierPayments
        .filter((p) => p.supplierId === id)
        .reduce((s, p) => s + p.amount, 0),
    }))
    .sort((a, b) => b.recibido - a.recibido || a.proveedor.localeCompare(b.proveedor))
  return {
    id: 'compras_proveedor',
    title: REPORT_LABELS.compras_proveedor,
    period,
    columns: [
      { key: 'proveedor', label: 'Proveedor', kind: 'text' },
      { key: 'recibido', label: 'Recibido en el periodo', kind: 'cop' },
      { key: 'pagado', label: 'Pagado en el periodo', kind: 'cop' },
    ],
    rows,
    totals: { proveedor: 'Total', ...sumOf(rows, ['recibido', 'pagado']) },
    note: 'El pago puede corresponder a pedidos de periodos anteriores.',
  }
}

function cierresCaja(input: ReportInput, period: string): ReportTable {
  const rows = input.sessions
    .filter((s) => s.status === 'cerrada')
    .sort((a, b) => b.number - a.number)
    .map((s) => ({
      fecha: s.businessDate,
      caja: `#${s.number}`,
      inicial: s.openingBalance,
      ventas: s.sales,
      esperado: s.expectedCash ?? 0,
      contado: s.countedCash ?? 0,
      diferencia: s.difference ?? 0,
      motivo: s.differenceReason ?? '',
    }))
  return {
    id: 'cierres_caja',
    title: REPORT_LABELS.cierres_caja,
    period,
    columns: [
      { key: 'fecha', label: 'Jornada', kind: 'text' },
      { key: 'caja', label: 'Caja', kind: 'text' },
      { key: 'inicial', label: 'Saldo inicial', kind: 'cop' },
      { key: 'ventas', label: 'Ventas', kind: 'cop' },
      { key: 'esperado', label: 'Esperado', kind: 'cop' },
      { key: 'contado', label: 'Contado', kind: 'cop' },
      { key: 'diferencia', label: 'Diferencia', kind: 'cop' },
      { key: 'motivo', label: 'Motivo', kind: 'text' },
    ],
    rows,
    totals: {
      fecha: 'Total',
      ventas: sumOf(rows, ['ventas'])['ventas'] ?? 0,
      diferencia: sumOf(rows, ['diferencia'])['diferencia'] ?? 0,
    },
    note: 'Solo cajas cerradas.',
  }
}

function resumenFinanciero(input: ReportInput, period: string): ReportTable {
  const t = mergeDeltas(...input.days)
  const st = incomeStatement(t)
  const cf = cashFlow(t)
  const items: [string, number][] = [
    ['Ventas', st.sales],
    ['Costo de lo vendido', st.cogs],
    ['Utilidad bruta', st.grossProfit],
    ['Pérdidas netas de inventario y cuentas', st.losses],
    ['Gastos fijos', st.fixed],
    ['Gastos variables', st.variable],
    ['Utilidad operativa', st.operatingProfit],
    ['Equipamiento (fuera de la utilidad)', st.investment],
    ['Entradas de caja (cobros, aportes y extras)', cf.inTotal],
    ['Salidas de caja (proveedores, gastos, inversión y retiros)', cf.outTotal],
    ['Flujo neto de caja', cf.net],
  ]
  return {
    id: 'resumen_financiero',
    title: REPORT_LABELS.resumen_financiero,
    period,
    columns: [
      { key: 'concepto', label: 'Concepto', kind: 'text' },
      { key: 'valor', label: 'Valor', kind: 'cop' },
    ],
    rows: items.map(([concepto, valor]) => ({ concepto, valor })),
    totals: null,
    note: 'La utilidad no incluye la compra de mercancía: se resta al venderse (costo de lo vendido).',
  }
}

// ---------------------------------------------------------------------------
// Entrada pública
// ---------------------------------------------------------------------------

/** Construye la tabla de un reporte a partir de los datos del periodo. */
export function buildReport(id: ReportId, input: ReportInput): ReportTable {
  const period = PERIOD_FREE_REPORTS.includes(id) ? 'Estado actual' : periodLabel(input.range)
  switch (id) {
    case 'ventas_diarias':
      return ventasDiarias(input, period)
    case 'ventas_semanales':
      return ventasSemanales(input, period)
    case 'ventas_mensuales':
      return ventasMensuales(input, period)
    case 'inventario_actual':
      return inventarioActual(input)
    case 'movimientos_inventario':
      return movimientosInventario(input, period)
    case 'mas_vendidos':
      return masVendidos(salesOf(input), period)
    case 'menos_vendidos':
      return menosVendidos(salesOf(input), period)
    case 'rentabilidad':
      return rentabilidad(salesOf(input), period)
    case 'gastos':
      return gastos(input, period)
    case 'compras_proveedor':
      return comprasProveedor(input, period)
    case 'cierres_caja':
      return cierresCaja(input, period)
    case 'resumen_financiero':
      return resumenFinanciero(input, period)
  }
}

function salesOf(input: ReportInput): ProductSales[] {
  const categoryNames = new Map(input.products.map((p) => [p.categoryId, p.categoryName]))
  return productSales(input.days, categoryNames)
}

// ---------------------------------------------------------------------------
// Periodos y texto de celdas (pantalla, CSV, Excel y PDF)
// ---------------------------------------------------------------------------

export type Preset = 'hoy' | 'semana' | 'mes' | 'mes_anterior' | 'personal'

export const PRESETS: { id: Preset; label: string }[] = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Últimos 7 días' },
  { id: 'mes', label: 'Este mes' },
  { id: 'mes_anterior', label: 'Mes anterior' },
  { id: 'personal', label: 'Otro periodo' },
]

/** Máximo de jornadas por consulta de reportes (un año). */
export const MAX_REPORT_DAYS = 366

/** Rango de jornadas según el preset. Nunca se corta en hoy para los periodos del mes. */
export function rangeFor(preset: Exclude<Preset, 'personal'>, today: string): BusinessDateRange {
  if (preset === 'hoy') return { from: today, to: today }
  if (preset === 'semana') return { from: addBusinessDays(today, -6), to: today }
  if (preset === 'mes') {
    const m = monthRangeOf(today)
    return { from: m.from, to: today }
  }
  const prevMonthEnd = addBusinessDays(monthRangeOf(today).from, -1)
  return monthRangeOf(prevMonthEnd)
}

/** Validación del periodo elegido a mano. Devuelve el mensaje de error o null. */
export function validateCustomRange(from: string, to: string): string | null {
  if (!isBusinessDate(from) || !isBusinessDate(to)) return 'Elige las dos fechas.'
  if (from > to) return 'La fecha inicial no puede ser posterior a la final.'
  const days = Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  )
  if (days + 1 > MAX_REPORT_DAYS) return `El periodo máximo es de ${MAX_REPORT_DAYS} días.`
  return null
}

/** Texto de una celda según su tipo (pantalla y vista de impresión). */
export function formatCell(value: Cell | undefined, kind: ColumnKind): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string') return value
  if (kind === 'cop') return formatCop(value)
  if (kind === 'pct') return `${value.toFixed(1).replace('.', ',')} %`
  return value.toLocaleString('es-CO')
}
