/**
 * Cuentas (mesas y barra) — BUSINESS_RULES R-VEN-02…06, R-VEN-11/12 y D-217.
 * Lógica pura: los servicios la ejecutan dentro de transacciones de Firestore.
 */
import { formatCop, type Cop } from '@/domain/money'

export type OrderType = 'mesa' | 'barra'

/**
 * R-VEN-02 (+ `cerrada_sin_consumo`, D-217). `pagada` es definitiva: sin anulaciones ni
 * reembolsos en V1 (D-219), así que `anulada` no se usa.
 */
export type OrderStatus = 'abierta' | 'por_cobrar' | 'cerrada_sin_consumo' | 'pagada' | 'anulada'

export const OPEN_STATUSES: readonly OrderStatus[] = ['abierta', 'por_cobrar']

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  abierta: 'Abierta',
  por_cobrar: 'Por cobrar',
  cerrada_sin_consumo: 'Cerrada sin consumo',
  pagada: 'Pagada',
  anulada: 'Anulada',
}

/** Línea de la cuenta. Precio y costo congelados al confirmar (R-VEN-03, R-VEN-12). */
export interface OrderLine {
  lineId: string
  productId: string
  nameSnap: string
  categoryIdSnap: string
  unitPrice: Cop
  unitCostSnap: Cop
  qty: number
  /** Unidades devueltas al stock (no servidas), R-VEN-05. */
  cancelledQty: number
  /** Unidades servidas que el cliente no paga: pérdida a costo, sin movimiento (D-217). */
  lostQty: number
  lastCancelId: string | null
  addedAt: Date | null
  /** Ronda a la que pertenece la línea (D-230): cada confirmación de la ronda tiene su ID. */
  roundId: string
}

export interface Order {
  id: string
  number: number
  type: OrderType
  tableId: string | null
  tableName: string | null
  /** Nombre opcional de una cuenta de barra ("Juan"). */
  label: string | null
  status: OrderStatus
  cashSessionId: string
  businessDate: string
  /** Líneas ordenadas por hora de confirmación. */
  lines: OrderLine[]
  subtotal: Cop
  total: Cop
  paidTotal: Cop
  balance: Cop
  openedAt: Date | null
  closedAt: Date | null
  /** Lo pagado de cada ronda (ID de ronda → monto), D-230. */
  rounds: Record<string, Cop>
}

export class OrderError extends Error {
  override name = 'OrderError'
}

export const isOpen = (status: OrderStatus) => OPEN_STATUSES.includes(status)

/** Cantidad que sigue cobrándose en la línea. */
export function activeQty(line: Pick<OrderLine, 'qty' | 'cancelledQty' | 'lostQty'>): number {
  return line.qty - line.cancelledQty - line.lostQty
}

/** Subtotal = Σ precio × cantidad activa (sin descuentos en V1, D-217). */
export function orderSubtotal(lines: readonly OrderLine[]): Cop {
  return lines.reduce((sum, l) => sum + l.unitPrice * activeQty(l), 0)
}

/** Valor a costo de lo servido y no cobrado (parte de F-10). */
export function orderLossValue(lines: readonly OrderLine[]): Cop {
  return lines.reduce((sum, l) => sum + l.unitCostSnap * l.lostQty, 0)
}

/** Estado de la mesa que corresponde al de su cuenta. */
export function tableStatusFor(status: OrderStatus): 'ocupada' | 'por_cobrar' {
  return status === 'por_cobrar' ? 'por_cobrar' : 'ocupada'
}

/** Nombre visible de la cuenta. */
export function orderTitle(o: Pick<Order, 'type' | 'tableName' | 'label' | 'number'>): string {
  if (o.type === 'mesa') return o.tableName ?? 'Mesa'
  return o.label ? `Barra: ${o.label}` : `Barra #${o.number}`
}

// ---------------------------------------------------------------------------
// Venta de una línea (R-VEN-03)
// ---------------------------------------------------------------------------

export interface SellableProduct {
  id: string
  name: string
  categoryId: string
  stock: number
  avgCost: Cop
  salePrice: Cop
  active: boolean
}

/** Valida que se pueda vender `qty` del producto. Lanza OrderError con un mensaje claro. */
export function assertSellable(product: SellableProduct, qty: number) {
  if (!Number.isSafeInteger(qty) || qty <= 0) {
    throw new OrderError('La cantidad debe ser un número entero mayor que cero.')
  }
  // R-INV-10: un producto inactivo no se vende.
  if (!product.active) throw new OrderError(`"${product.name}" está desactivado.`)
  // D-217: no se vende con precio $0.
  if (product.salePrice <= 0) throw new OrderError(`"${product.name}" no tiene precio de venta.`)
  // R-INV-02 / D-102: nunca vender sin stock.
  if (qty > product.stock) {
    throw new OrderError(
      product.stock === 0
        ? `"${product.name}" está agotado.`
        : `Solo quedan ${product.stock} de "${product.name}".`,
    )
  }
}

/** Datos de la línea nueva, con precio y costo congelados. */
export function buildLine(product: SellableProduct, qty: number) {
  assertSellable(product, qty)
  return {
    productId: product.id,
    nameSnap: product.name,
    categoryIdSnap: product.categoryId,
    unitPrice: product.salePrice,
    unitCostSnap: product.avgCost,
    qty,
    cancelledQty: 0,
    lostQty: 0,
    lastCancelId: null,
  }
}

// ---------------------------------------------------------------------------
// Ronda (D-217): selección local antes de confirmar
// ---------------------------------------------------------------------------

/** Ronda de la cuenta: sus líneas, cuánto vale, cuánto está pagado y cuánto falta (D-230). */
export interface BilledRound {
  id: string
  /** Número de ronda dentro de la cuenta (1, 2, …) en orden de confirmación. */
  number: number
  lines: OrderLine[]
  total: Cop
  paid: Cop
  pending: Cop
  at: Date | null
}

/** Total de una ronda con sus unidades activas (precio congelado de cada línea). */
export function billedRoundTotal(lines: readonly OrderLine[], roundId: string): Cop {
  return lines
    .filter((l) => l.roundId === roundId)
    .reduce((sum, l) => sum + l.unitPrice * activeQty(l), 0)
}

/** Rondas de la cuenta en orden de confirmación; las que quedan sin unidades activas no aparecen. */
export function billedRounds(order: Pick<Order, 'lines' | 'rounds'>): BilledRound[] {
  const ids: string[] = []
  for (const l of order.lines) if (!ids.includes(l.roundId)) ids.push(l.roundId)
  return (
    ids
      .map((id) => {
        const lines = order.lines.filter((l) => l.roundId === id)
        const total = billedRoundTotal(lines, id)
        const paid = Math.min(order.rounds[id] ?? 0, total)
        return { id, lines, total, paid, pending: total - paid, at: earliest(lines) }
      })
      .filter((r) => r.total > 0)
      // Numeración sin huecos: una ronda cancelada no deja "Ronda 1" vacía.
      .map((r, i): BilledRound => ({ ...r, number: i + 1 }))
  )
}

function earliest(lines: readonly OrderLine[]): Date | null {
  const times = lines.flatMap((l) => (l.addedAt ? [l.addedAt.getTime()] : []))
  return times.length > 0 ? new Date(Math.min(...times)) : null
}

/**
 * D-230: cancelar `unitsOut` unidades de una línea no puede bajar su ronda por debajo de lo ya
 * cobrado. Devuelve el mensaje de error, o null si la cancelación se puede hacer.
 */
export function roundCancellationError(
  order: Pick<Order, 'lines' | 'rounds'>,
  line: Pick<OrderLine, 'roundId' | 'unitPrice'>,
  unitsOut: number,
): string | null {
  const total = billedRoundTotal(order.lines, line.roundId)
  const paid = order.rounds[line.roundId] ?? 0
  if (total - line.unitPrice * unitsOut >= paid) return null
  return `Esa ronda ya tiene ${formatCop(paid)} cobrados: solo se puede cancelar hasta ${formatCop(Math.max(0, total - paid))}.`
}

/** Lo que falta por cobrar de una ronda (0 si no existe). */
export function roundPending(order: Pick<Order, 'lines' | 'rounds'>, roundId: string): Cop {
  return billedRounds(order).find((r) => r.id === roundId)?.pending ?? 0
}

export interface RoundItem {
  /** ID de la línea que se creará; se genera al tocar el producto (idempotencia, D-203). */
  lineId: string
  productId: string
  qty: number
}

/**
 * Suma o resta una unidad de un producto en la ronda. Nunca supera el stock disponible
 * (R-INV-02); si la cantidad llega a 0 se quita de la ronda.
 */
export function changeRoundQty(
  round: readonly RoundItem[],
  productId: string,
  delta: number,
  stock: number,
  newLineId: () => string,
): RoundItem[] {
  const current = round.find((r) => r.productId === productId)
  const qty = Math.min(Math.max((current?.qty ?? 0) + delta, 0), stock)
  if (!current) return qty > 0 ? [...round, { lineId: newLineId(), productId, qty }] : [...round]
  if (qty === 0) return round.filter((r) => r.productId !== productId)
  return round.map((r) => (r.productId === productId ? { ...r, qty } : r))
}

/** Total estimado de la ronda con los precios actuales. */
export function roundTotal(round: readonly RoundItem[], priceOf: (productId: string) => Cop): Cop {
  return round.reduce((sum, r) => sum + priceOf(r.productId) * r.qty, 0)
}

// ---------------------------------------------------------------------------
// Cancelación (R-VEN-05, D-217)
// ---------------------------------------------------------------------------

/** `devolver`: no se sirvió, vuelve al stock. `perdida`: se sirvió y no se cobra. */
export type CancelMode = 'devolver' | 'perdida'

export interface CancelPlan {
  cancelledQty: number
  lostQty: number
  /** Cantidad que vuelve al stock (0 si es pérdida). */
  returnQty: number
  /** Cuánto baja el subtotal. */
  subtotalDelta: Cop
}

export function planCancellation(
  line: OrderLine,
  qty: number,
  mode: CancelMode,
  reason: string | null,
): CancelPlan {
  if (!Number.isSafeInteger(qty) || qty <= 0) {
    throw new OrderError('La cantidad a cancelar debe ser un entero mayor que cero.')
  }
  const available = activeQty(line)
  if (qty > available) {
    throw new OrderError(`Solo hay ${available} activas en esta línea.`)
  }
  if (!reason || reason.trim().length < 3) throw new OrderError('Escribe el motivo.')
  return {
    cancelledQty: line.cancelledQty + (mode === 'devolver' ? qty : 0),
    lostQty: line.lostQty + (mode === 'perdida' ? qty : 0),
    returnQty: mode === 'devolver' ? qty : 0,
    subtotalDelta: -line.unitPrice * qty,
  }
}

// ---------------------------------------------------------------------------
// Cuenta agrupada por producto (D-218)
// ---------------------------------------------------------------------------

/**
 * Lo que se ve en la cuenta: un renglón por producto y precio. Por dentro siguen existiendo
 * las líneas de cada ronda (una por movimiento de inventario, R-VEN-04).
 */
export interface LineGroup {
  /** `productId` + precio: si el precio cambió entre rondas, se ven como renglones distintos. */
  key: string
  productId: string
  nameSnap: string
  unitPrice: Cop
  /** Líneas originales, en orden de confirmación. */
  lines: OrderLine[]
  qty: number
  activeQty: number
  cancelledQty: number
  lostQty: number
}

export function groupLines(lines: readonly OrderLine[]): LineGroup[] {
  const groups = new Map<string, LineGroup>()
  for (const l of lines) {
    const key = `${l.productId}@${l.unitPrice}`
    const g = groups.get(key) ?? {
      key,
      productId: l.productId,
      nameSnap: l.nameSnap,
      unitPrice: l.unitPrice,
      lines: [],
      qty: 0,
      activeQty: 0,
      cancelledQty: 0,
      lostQty: 0,
    }
    g.lines.push(l)
    g.qty += l.qty
    g.activeQty += activeQty(l)
    g.cancelledQty += l.cancelledQty
    g.lostQty += l.lostQty
    groups.set(key, g)
  }
  // Con unidades activas primero; dentro de cada bloque, en orden de primera confirmación.
  const all = [...groups.values()]
  return [...all.filter((g) => g.activeQty > 0), ...all.filter((g) => g.activeQty === 0)]
}

/**
 * Reparte una cancelación del renglón entre sus líneas, empezando por la más reciente.
 * Cada parte se registra en su propia transacción (las reglas validan una línea por escritura).
 */
export function splitGroupCancellation(
  group: Pick<LineGroup, 'lines' | 'activeQty'>,
  qty: number,
): { line: OrderLine; qty: number }[] {
  if (!Number.isSafeInteger(qty) || qty <= 0) {
    throw new OrderError('La cantidad a cancelar debe ser un entero mayor que cero.')
  }
  if (qty > group.activeQty) throw new OrderError(`Solo hay ${group.activeQty} activas.`)
  const parts: { line: OrderLine; qty: number }[] = []
  let left = qty
  for (const line of [...group.lines].reverse()) {
    if (left === 0) break
    const take = Math.min(activeQty(line), left)
    if (take > 0) {
      parts.push({ line, qty: take })
      left -= take
    }
  }
  return parts
}

/**
 * Unidades del renglón que aún se pueden cancelar (D-219): sin reembolsos, lo ya pagado no se
 * devuelve, así que la cancelación no puede bajar el total por debajo de lo pagado.
 */
export function cancellableQty(
  group: Pick<LineGroup, 'lines' | 'unitPrice'>,
  order: Pick<Order, 'lines' | 'rounds'>,
): number {
  if (group.unitPrice <= 0) return group.lines.reduce((n, l) => n + activeQty(l), 0)
  return group.lines.reduce((n, l) => {
    const left = billedRoundTotal(order.lines, l.roundId) - (order.rounds[l.roundId] ?? 0)
    return n + Math.min(activeQty(l), Math.max(0, Math.floor(left / group.unitPrice)))
  }, 0)
}

/** R-VEN-02 / D-217: solo se cierra sin consumo si no queda nada por cobrar. */
export function canCloseWithoutConsumption(o: Pick<Order, 'status' | 'subtotal'>): boolean {
  return isOpen(o.status) && o.subtotal === 0
}

// ---------------------------------------------------------------------------
// Presentación
// ---------------------------------------------------------------------------

/** "25 min", "1 h 20 min". */
export function formatElapsed(from: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000))
  if (minutes < 1) return 'Recién abierta'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** "abierta hace 25 min" o "recién abierta". */
export function openedText(openedAt: Date | null, now: Date): string {
  if (!openedAt) return 'recién abierta'
  const t = formatElapsed(openedAt, now)
  return t === 'Recién abierta' ? 'recién abierta' : `abierta hace ${t}`
}

/** Etiqueta de barra: se recorta y, si queda vacía, es null. */
export function normalizeLabel(label: string | null | undefined): string | null {
  const t = (label ?? '').trim().replace(/\s+/g, ' ')
  return t.length === 0 ? null : t.slice(0, 40)
}
