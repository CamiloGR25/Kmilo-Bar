/** Líneas de un pedido mientras se editan (en unidades o en la unidad de compra, D-223 #2). */
import type { Product } from '@/features/products/domain/catalog'
import {
  purchaseUnitOf,
  unitCostFromPack,
  type DraftLineInput,
  type PurchaseUnit,
} from './purchases'

/** Línea en edición: cantidad y costo como los escribe el usuario (en unidades o en canastas). */
export interface EditableLine {
  productId: string
  name: string
  unit: PurchaseUnit | null
  /** 'pack' = canastas/pacas (D-223 #2). */
  mode: 'unidad' | 'pack'
  qty: number | null
  cost: number | null
}

/** Convierte lo escrito a unidades y costo por unidad. */
export function toDraft(l: EditableLine): DraftLineInput {
  const pack = l.mode === 'pack' && l.unit
  return {
    productId: l.productId,
    name: l.name,
    qty: l.qty === null ? null : pack ? l.qty * l.unit!.units : l.qty,
    estUnitCost: l.cost === null ? null : pack ? unitCostFromPack(l.cost, l.unit!.units) : l.cost,
  }
}

/** Línea nueva para un producto, con su costo de referencia por unidad. */
export function newLine(product: Product, unitCost: number, qtyUnits = 0): EditableLine {
  const unit = purchaseUnitOf(product)
  const usePack = Boolean(unit && (qtyUnits === 0 || qtyUnits % unit.units === 0))
  return {
    productId: product.id,
    name: product.name,
    unit,
    mode: usePack ? 'pack' : 'unidad',
    qty: qtyUnits > 0 ? (usePack ? qtyUnits / unit!.units : qtyUnits) : null,
    cost: unitCost > 0 ? (usePack ? unitCost * unit!.units : unitCost) : null,
  }
}

export const lineTotal = (l: EditableLine) => {
  const d = toDraft(l)
  return d.qty !== null && d.estUnitCost !== null ? d.qty * d.estUnitCost : 0
}
