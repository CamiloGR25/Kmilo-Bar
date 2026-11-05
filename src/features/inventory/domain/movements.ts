/**
 * Movimientos de inventario — BUSINESS_RULES R-INV-01…05 y F-09 (costo promedio ponderado).
 * Lógica pura: el servicio la ejecuta dentro de una transacción de Firestore.
 */
import { roundHalfAwayFromZero, type Cop } from '@/domain/money'

/** Tipos que se registran manualmente en la Fase 3 (las ventas y compras llegan en fases 4 y 7). */
export const MANUAL_MOVEMENT_TYPES = [
  'entrada_inicial',
  'entrada_manual',
  'merma',
  'danado',
  'vencido',
  'cortesia',
  'consumo_propio',
  'ajuste_positivo',
  'ajuste_negativo',
] as const

/** Todos los tipos de R-INV-04 (los de fases futuras ya quedan definidos). */
export const MOVEMENT_TYPES = [
  ...MANUAL_MOVEMENT_TYPES,
  'entrada_compra',
  'venta',
  'cancelacion_item',
  'anulacion_venta',
  'conteo',
] as const

export type MovementType = (typeof MOVEMENT_TYPES)[number]
export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number]

/** Entradas que traen su propio costo y recalculan el promedio (F-09). */
export const COSTED_ENTRIES: readonly MovementType[] = [
  'entrada_inicial',
  'entrada_manual',
  'entrada_compra',
]

/** Salidas que no son venta: exigen motivo y se valoran al costo promedio (R-INV-05). */
export const LOSS_TYPES: readonly MovementType[] = [
  'merma',
  'danado',
  'vencido',
  'cortesia',
  'consumo_propio',
  'ajuste_negativo',
]

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  entrada_inicial: 'Inventario inicial',
  entrada_manual: 'Entrada de mercancía',
  entrada_compra: 'Compra recibida',
  venta: 'Venta',
  cancelacion_item: 'Ítem cancelado',
  anulacion_venta: 'Venta anulada',
  merma: 'Merma',
  danado: 'Dañado',
  vencido: 'Vencido',
  cortesia: 'Cortesía',
  consumo_propio: 'Consumo propio',
  ajuste_positivo: 'Ajuste (+)',
  ajuste_negativo: 'Ajuste (−)',
  conteo: 'Conteo físico',
}

/** +1 si el tipo suma stock, −1 si resta, 0 si depende de la cantidad (conteo). */
export function movementSign(type: MovementType): 1 | -1 | 0 {
  switch (type) {
    case 'entrada_inicial':
    case 'entrada_manual':
    case 'entrada_compra':
    case 'cancelacion_item':
    case 'anulacion_venta':
    case 'ajuste_positivo':
      return 1
    case 'conteo':
      return 0
    default:
      return -1
  }
}

/** Requiere motivo escrito (R-INV-05; también ajustes y conteo). */
export function requiresReason(type: MovementType): boolean {
  return LOSS_TYPES.includes(type) || type === 'ajuste_positivo' || type === 'conteo'
}

export class InventoryError extends Error {
  override name = 'InventoryError'
}

export interface StockState {
  stock: number
  avgCost: Cop
}

export interface MovementInput {
  type: MovementType
  /** Cantidad en unidades, siempre positiva (el signo lo da el tipo); en conteo es la diferencia con signo. */
  quantity: number
  /** Costo unitario de la entrada (solo entradas con costo). */
  unitCost?: Cop
  reason?: string | null
}

export interface MovementResult {
  /** Cantidad con signo aplicada al stock. */
  qty: number
  stockBefore: number
  stockAfter: number
  avgCostBefore: Cop
  avgCostAfter: Cop
  /** Costo con el que se valora el movimiento. */
  unitCost: Cop
}

/** F-09: costo promedio = (stock × promedio + entrada × costo) / (stock + entrada), al peso. */
export function weightedAverageCost(
  stock: number,
  avgCost: Cop,
  qtyIn: number,
  unitCost: Cop,
): Cop {
  const total = stock + qtyIn
  if (total <= 0) return unitCost
  return roundHalfAwayFromZero((stock * avgCost + qtyIn * unitCost) / total)
}

/**
 * Calcula el efecto de un movimiento sobre el stock y el costo promedio.
 * Lanza InventoryError si deja stock negativo (R-INV-02) o si faltan datos.
 */
export function applyMovement(state: StockState, input: MovementInput): MovementResult {
  const { type } = input
  if (!Number.isSafeInteger(input.quantity) || input.quantity === 0) {
    throw new InventoryError('La cantidad debe ser un número entero distinto de cero.')
  }
  const sign = movementSign(type)
  if (sign !== 0 && input.quantity < 0) {
    throw new InventoryError('La cantidad debe ser positiva.')
  }
  if (requiresReason(type) && !(input.reason && input.reason.trim().length >= 3)) {
    throw new InventoryError('Escribe el motivo del movimiento.')
  }

  const qty = sign === 0 ? input.quantity : sign * input.quantity
  const stockAfter = state.stock + qty
  if (stockAfter < 0) {
    throw new InventoryError(
      `No hay stock suficiente: hay ${state.stock} y se intenta descontar ${Math.abs(qty)}.`,
    )
  }

  let avgCostAfter = state.avgCost
  let unitCost = state.avgCost
  if (COSTED_ENTRIES.includes(type)) {
    if (
      input.unitCost === undefined ||
      !Number.isSafeInteger(input.unitCost) ||
      input.unitCost < 0
    ) {
      throw new InventoryError('Escribe el costo unitario de la entrada.')
    }
    unitCost = input.unitCost
    avgCostAfter = weightedAverageCost(state.stock, state.avgCost, qty, unitCost)
  }

  return {
    qty,
    stockBefore: state.stock,
    stockAfter,
    avgCostBefore: state.avgCost,
    avgCostAfter,
    unitCost,
  }
}

/** Valor del movimiento (cantidad × costo), con signo. Útil para pérdidas (F-10). */
export function movementValue(result: Pick<MovementResult, 'qty' | 'unitCost'>): Cop {
  return result.qty * result.unitCost
}
