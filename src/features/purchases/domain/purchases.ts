/**
 * Proveedores, pedidos de compra, recepciones y pagos — BUSINESS_RULES R-COM-01…06, F-09, F-15
 * y D-223. Lógica pura: los servicios la ejecutan dentro de transacciones de Firestore.
 */
import { formatBusinessDateLong, type BusinessDate } from '@/domain/dates'
import { formatCop, roundHalfAwayFromZero, type Cop } from '@/domain/money'

// ---------------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------------

export interface Supplier {
  id: string
  name: string
  contactName: string
  phone: string
  notes: string
  active: boolean
  /** Último costo por unidad que cobró este proveedor, por producto (D-223 #8). */
  lastCosts: Record<string, Cop>
}

export class PurchaseError extends Error {
  override name = 'PurchaseError'
}

// ---------------------------------------------------------------------------
// Unidad de compra (D-223 #2)
// ---------------------------------------------------------------------------

export interface PurchaseUnit {
  /** "Canasta", "Paca"… */
  name: string
  /** Unidades de venta que trae (≥ 2). */
  units: number
}

/** Unidad de compra de un producto (null si se compra por unidad). */
export function purchaseUnitOf(p: {
  purchaseUnit: string | null
  unitsPerPurchase: number | null
}): PurchaseUnit | null {
  return p.purchaseUnit && p.unitsPerPurchase && p.unitsPerPurchase >= 2
    ? { name: p.purchaseUnit, units: p.unitsPerPurchase }
    : null
}

/** Costo por unidad a partir del costo de la canasta, al peso (2 canastas de 30 a $ 72.000). */
export function unitCostFromPack(packCost: Cop, units: number): Cop {
  return roundHalfAwayFromZero(packCost / units)
}

/** "60 unidades" → "2 canastas"; si no es exacto, "65 unidades (2 canastas + 5)". */
export function describeQty(qty: number, unit: PurchaseUnit | null): string {
  const units = `${qty} ${qty === 1 ? 'unidad' : 'unidades'}`
  if (!unit || qty < unit.units) return units
  const packs = Math.floor(qty / unit.units)
  const rest = qty % unit.units
  const packText = `${packs} ${unit.name.toLowerCase()}${packs === 1 ? '' : 's'}`
  return rest === 0 ? `${packText} (${units})` : `${units} (${packText} + ${rest})`
}

// ---------------------------------------------------------------------------
// Pedidos (R-COM-01)
// ---------------------------------------------------------------------------

export type PurchaseStatus = 'borrador' | 'solicitado' | 'parcial' | 'recibido' | 'cancelado'
export type PurchaseKind = 'pedido' | 'directa'
export type PaymentStatus = 'pendiente' | 'abonado' | 'pagado'

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  borrador: 'Borrador',
  solicitado: 'Solicitado',
  parcial: 'Recibido en parte',
  recibido: 'Recibido',
  cancelado: 'Cancelado',
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pendiente: 'Sin pagar',
  abonado: 'Abonado',
  pagado: 'Pagado',
}

/** Estados en los que todavía puede llegar mercancía. */
export const RECEIVABLE: readonly PurchaseStatus[] = ['solicitado', 'parcial']

export interface PurchaseLine {
  lineId: string
  productId: string
  nameSnap: string
  qtyOrdered: number
  qtyReceived: number
  /** Costo estimado por unidad (F-15 compara contra el real). */
  estUnitCost: Cop
  addedAt: number
}

export interface PurchaseOrder {
  id: string
  number: number
  kind: PurchaseKind
  supplierId: string
  supplierName: string
  status: PurchaseStatus
  /** Pedido cerrado con faltante: lo pendiente ya no llega (R-COM-01). */
  shortClosed: boolean
  lines: PurchaseLine[]
  estTotal: Cop
  receivedTotal: Cop
  paidTotal: Cop
  paymentStatus: PaymentStatus
  expectedDate: BusinessDate | null
  notes: string
  createdAt: Date | null
  requestedAt: Date | null
  closedAt: Date | null
}

/** Lo que falta por llegar de una línea (nunca negativo). */
export const pendingQty = (l: Pick<PurchaseLine, 'qtyOrdered' | 'qtyReceived'>) =>
  Math.max(0, l.qtyOrdered - l.qtyReceived)

export function estTotalOf(lines: readonly Pick<PurchaseLine, 'qtyOrdered' | 'estUnitCost'>[]) {
  return lines.reduce((s, l) => s + l.qtyOrdered * l.estUnitCost, 0)
}

/** Saldo con el proveedor de un pedido: lo recibido menos lo pagado. */
export const orderBalance = (o: Pick<PurchaseOrder, 'receivedTotal' | 'paidTotal'>) =>
  Math.max(0, o.receivedTotal - o.paidTotal)

/** Saldo (lo que se le debe) y total comprado por proveedor. */
export function supplierTotals(orders: readonly PurchaseOrder[] | undefined) {
  const m = new Map<string, { debt: number; bought: number; open: number }>()
  for (const o of orders ?? []) {
    const t = m.get(o.supplierId) ?? { debt: 0, bought: 0, open: 0 }
    t.debt += orderBalance(o)
    t.bought += o.receivedTotal
    if (o.status === 'solicitado' || o.status === 'parcial') t.open++
    m.set(o.supplierId, t)
  }
  return m
}

/** R-COM-05: pendiente / abonado / pagado según lo recibido y lo pagado. */
export function paymentStatusOf(receivedTotal: Cop, paidTotal: Cop): PaymentStatus {
  if (paidTotal <= 0) return 'pendiente'
  return paidTotal >= receivedTotal ? 'pagado' : 'abonado'
}

/** Estado tras recibir: todo lo pedido llegó → recibido; si no, parcial. */
export function statusAfterReception(lines: readonly PurchaseLine[]): PurchaseStatus {
  return lines.every((l) => pendingQty(l) === 0) ? 'recibido' : 'parcial'
}

/** Cantidad pendiente por producto en los pedidos que siguen abiertos (para "Qué pedir"). */
export function pendingByProduct(orders: readonly PurchaseOrder[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const o of orders) {
    if (!RECEIVABLE.includes(o.status) || o.shortClosed) continue
    for (const l of o.lines) {
      const p = pendingQty(l)
      if (p > 0) m.set(l.productId, (m.get(l.productId) ?? 0) + p)
    }
  }
  return m
}

export interface DraftLineInput {
  productId: string
  name: string
  qty: number | null
  estUnitCost: number | null
}

/** Valida las líneas de un pedido o compra antes de guardarlo. */
export function validateLines(lines: readonly DraftLineInput[]): string | null {
  if (lines.length === 0) return 'Agrega al menos un producto.'
  if (lines.length > 60) return 'Máximo 60 productos por pedido.'
  const seen = new Set<string>()
  for (const l of lines) {
    if (seen.has(l.productId)) return `"${l.name}" está repetido.`
    seen.add(l.productId)
    if (!l.qty || !Number.isSafeInteger(l.qty) || l.qty <= 0) {
      return `Escribe la cantidad de "${l.name}".`
    }
    if (l.qty > 100_000) return `La cantidad de "${l.name}" es demasiado alta.`
    if (l.estUnitCost === null || !Number.isSafeInteger(l.estUnitCost) || l.estUnitCost < 0) {
      return `Escribe el costo de "${l.name}".`
    }
    if (l.estUnitCost > 10_000_000) return `El costo de "${l.name}" es demasiado alto.`
  }
  return null
}

// ---------------------------------------------------------------------------
// Recepción (R-COM-02…04)
// ---------------------------------------------------------------------------

export interface ReceptionLineInput {
  lineId: string
  /** Unidades que llegaron (0 = no llegó). */
  qty: number | null
  /** Costo real por unidad (R-COM-04). */
  unitCost: number | null
}

export interface ReceptionLine {
  lineId: string
  productId: string
  name: string
  qty: number
  unitCost: Cop
  /** F-15 por unidad: real − estimado. */
  variance: Cop
  /** Llegó más de lo pendiente (R-COM-03): exige confirmación. */
  over: boolean
}

export interface ReceptionPlan {
  lines: ReceptionLine[]
  total: Cop
  estTotal: Cop
  /** F-15 total: real − estimado de lo recibido. */
  variance: Cop
  hasOver: boolean
}

/** Valida lo que llegó y calcula totales y variaciones. Solo incluye líneas con cantidad. */
export function planReception(
  order: Pick<PurchaseOrder, 'lines'>,
  input: readonly ReceptionLineInput[],
): ReceptionPlan {
  const byId = new Map(order.lines.map((l) => [l.lineId, l]))
  const lines: ReceptionLine[] = []
  for (const i of input) {
    const l = byId.get(i.lineId)
    if (!l) throw new PurchaseError('El pedido cambió. Vuelve a abrirlo.')
    if (i.qty === null || i.qty === 0) continue
    if (!Number.isSafeInteger(i.qty) || i.qty < 0) {
      throw new PurchaseError(`La cantidad de "${l.nameSnap}" debe ser un número entero.`)
    }
    if (i.qty > 100_000) throw new PurchaseError(`La cantidad de "${l.nameSnap}" es muy alta.`)
    if (i.unitCost === null || !Number.isSafeInteger(i.unitCost) || i.unitCost < 0) {
      throw new PurchaseError(`Escribe el costo real de "${l.nameSnap}".`)
    }
    lines.push({
      lineId: l.lineId,
      productId: l.productId,
      name: l.nameSnap,
      qty: i.qty,
      unitCost: i.unitCost,
      variance: i.unitCost - l.estUnitCost,
      over: i.qty > pendingQty(l),
    })
  }
  if (lines.length === 0) throw new PurchaseError('Escribe lo que llegó.')
  const total = lines.reduce((s, l) => s + l.qty * l.unitCost, 0)
  const estTotal = lines.reduce((s, l) => s + l.qty * (l.unitCost - l.variance), 0)
  return { lines, total, estTotal, variance: total - estTotal, hasOver: lines.some((l) => l.over) }
}

/**
 * Líneas por transacción al recibir: cada línea valida producto y movimiento en las reglas, que
 * tienen un límite de lecturas por transacción. Cada grupo es una recepción propia (`{opId}-{n}`).
 */
export const RECEPTION_CHUNK = 2

export function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

// ---------------------------------------------------------------------------
// Pagos (R-COM-05, D-223 #3/#4)
// ---------------------------------------------------------------------------

export type SupplierPayMethod = 'efectivo' | 'transferencia'

/** Valida un pago: positivo, sin pasar el saldo del pedido. */
export function validateSupplierPayment(amount: number | null, balance: Cop): string | null {
  if (amount === null || !Number.isSafeInteger(amount) || amount <= 0) return 'Escribe el monto.'
  if (amount > balance) return `El saldo del pedido es ${formatCop(balance)}.`
  return null
}

// ---------------------------------------------------------------------------
// Comparación de precios (D-223 #8, F-15)
// ---------------------------------------------------------------------------

export interface PurchaseCostEntry {
  supplierId: string | null
  qty: number
  unitCost: Cop
  at: Date | null
}

export interface SupplierCostStats {
  supplierId: string | null
  last: Cop
  lastAt: Date | null
  min: Cop
  /** Promedio ponderado por cantidad. */
  avg: Cop
  qty: number
}

/** Último, mínimo y promedio por proveedor (las entradas vienen de la más reciente a la más antigua). */
export function costStatsBySupplier(entries: readonly PurchaseCostEntry[]): SupplierCostStats[] {
  const m = new Map<
    string | null,
    { last: Cop; lastAt: Date | null; min: Cop; sum: number; qty: number }
  >()
  for (const e of entries) {
    const s = m.get(e.supplierId)
    if (!s) {
      m.set(e.supplierId, {
        last: e.unitCost,
        lastAt: e.at,
        min: e.unitCost,
        sum: e.unitCost * e.qty,
        qty: e.qty,
      })
    } else {
      s.min = Math.min(s.min, e.unitCost)
      s.sum += e.unitCost * e.qty
      s.qty += e.qty
    }
  }
  return [...m.entries()]
    .map(([supplierId, s]) => ({
      supplierId,
      last: s.last,
      lastAt: s.lastAt,
      min: s.min,
      avg: s.qty > 0 ? roundHalfAwayFromZero(s.sum / s.qty) : s.last,
      qty: s.qty,
    }))
    .sort((a, b) => a.last - b.last)
}

// ---------------------------------------------------------------------------
// Texto del pedido para WhatsApp (D-223 #6)
// ---------------------------------------------------------------------------

export function orderText(
  businessName: string,
  order: Pick<PurchaseOrder, 'number' | 'supplierName' | 'lines' | 'expectedDate' | 'notes'>,
  unitOf: (productId: string) => PurchaseUnit | null,
): string {
  const lines = [
    `*Pedido ${businessName}* #${order.number}`,
    `Para: ${order.supplierName}`,
    '',
    ...order.lines.map((l) => `- ${l.nameSnap}: ${describeQty(l.qtyOrdered, unitOf(l.productId))}`),
  ]
  if (order.expectedDate) {
    lines.push('', `Para el ${formatBusinessDateLong(order.expectedDate)}`)
  }
  if (order.notes.trim()) lines.push('', order.notes.trim())
  lines.push('', 'Gracias.')
  return lines.join('\n')
}
