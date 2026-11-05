import { useMemo } from 'react'
import type { Category, Product } from '@/features/products/domain/catalog'
import { useCategories, useProducts } from '@/features/products/services/catalog-service'
import type { Settings } from '@/features/settings/domain/settings'
import { useSettings } from '@/features/settings/services/settings-service'
import {
  isAlert,
  LEVEL_ORDER,
  recommendedOrderQty,
  stockLevel,
  type StockLevel,
} from '../domain/stock'

export interface InventoryItem {
  product: Product
  category: Category | undefined
  level: StockLevel
  /** Cantidad sugerida a pedir (R-INV-08). */
  suggestedQty: number
}

/** Productos activos con su nivel de stock y recomendación, ordenados por urgencia. */
export function useInventory() {
  const products = useProducts()
  const categories = useCategories()
  const settings = useSettings()

  const items = useMemo(() => {
    const s = settings.data?.settings
    if (!products.data || !s) return undefined
    const byId = new Map((categories.data ?? []).map((c) => [c.id, c]))
    return buildItems(products.data, byId, s)
  }, [products.data, categories.data, settings.data])

  return {
    items,
    categories: categories.data ?? [],
    settings: settings.data?.settings,
    loading: products.loading || categories.loading || settings.loading,
    error: products.error ?? categories.error ?? settings.error,
  }
}

export function buildItems(
  products: Product[],
  categories: Map<string, Category>,
  s: Settings,
): InventoryItem[] {
  return products
    .filter((p) => p.active)
    .map((p) => {
      const level = stockLevel(p.stock, p.minStock, s.nearMinFactorBp)
      return {
        product: p,
        category: categories.get(p.categoryId),
        level,
        suggestedQty: recommendedOrderQty(p.stock, p.minStock, s.targetStockFactorBp),
      }
    })
    .sort(
      (a, b) =>
        LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] ||
        a.product.name.localeCompare(b.product.name, 'es'),
    )
}

/** Cantidad de productos en alerta (agotados + en mínimo), para las insignias del menú. */
export function countAlerts(items: InventoryItem[] | undefined): number {
  return items?.filter((i) => isAlert(i.level)).length ?? 0
}
