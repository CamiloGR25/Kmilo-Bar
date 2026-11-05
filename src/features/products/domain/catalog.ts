/**
 * Catálogo: categorías, unidades y datos de ejemplo (Fase 2).
 * Los precios de ejemplo son FICTICIOS: sirven para probar el sistema, no son precios reales.
 */
import type { PricingMode } from '@/domain/metrics/pricing'
import type { Bp, Cop } from '@/domain/money'

/** Íconos disponibles para categorías (P-01: ícono por categoría en lugar de fotos). */
export const CATEGORY_ICONS = [
  'beer',
  'wine',
  'martini',
  'glass-water',
  'cup-soda',
  'citrus',
  'zap',
  'cookie',
  'package',
] as const
export type CategoryIcon = (typeof CATEGORY_ICONS)[number]

export interface Category {
  id: string
  name: string
  icon: CategoryIcon
  active: boolean
  sortOrder: number
}

export const UNITS = [
  'unidad',
  'botella',
  'media botella',
  'lata',
  'paquete',
  'vaso',
  'otro',
] as const
export type Unit = (typeof UNITS)[number]

export interface Product {
  id: string
  name: string
  description: string
  categoryId: string
  unit: Unit
  stock: number
  minStock: number
  /** Costo promedio ponderado (D-105). En la Fase 2 es el costo de compra registrado. */
  avgCost: Cop
  lastPurchaseCost: Cop
  salePrice: Cop
  pricingMode: PricingMode
  /** Recargo propio; null = usa el general. */
  markupBp: Bp | null
  active: boolean
  createdAt: Date | null
  updatedAt: Date | null
}

/** Categorías iniciales confirmadas por el usuario (PRODUCT_REQUIREMENTS M3). */
export const INITIAL_CATEGORIES: Omit<Category, 'id'>[] = [
  { name: 'Cervezas', icon: 'beer', active: true, sortOrder: 1 },
  { name: 'Aguardientes', icon: 'wine', active: true, sortOrder: 2 },
  { name: 'Rones', icon: 'wine', active: true, sortOrder: 3 },
  { name: 'Whiskies', icon: 'martini', active: true, sortOrder: 4 },
  { name: 'Vodkas', icon: 'martini', active: true, sortOrder: 5 },
  { name: 'Tequilas', icon: 'martini', active: true, sortOrder: 6 },
  { name: 'Gaseosas', icon: 'cup-soda', active: true, sortOrder: 7 },
  { name: 'Aguas', icon: 'glass-water', active: true, sortOrder: 8 },
  { name: 'Energizantes', icon: 'zap', active: true, sortOrder: 9 },
  { name: 'Jugos', icon: 'citrus', active: true, sortOrder: 10 },
  { name: 'Snacks', icon: 'cookie', active: true, sortOrder: 11 },
  { name: 'Otros', icon: 'package', active: true, sortOrder: 12 },
]

/** ID estable de categoría a partir del nombre ("Cervezas" → "cervezas"). */
export function categoryIdFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export interface ProductDraft {
  name: string
  description: string
  categoryName: string
  unit: Unit
  cost: Cop
  minStock: number
  /** null = precio automático; número = precio manual. */
  manualPrice: Cop | null
  /** null = recargo general. */
  markupBp: Bp | null
}

/** Catálogo de ejemplo con costos FICTICIOS (P-07). Nombres genéricos, sin marcas. */
export const SAMPLE_CATALOG: ProductDraft[] = [
  draft('Cerveza nacional 330 ml', 'Cervezas', 'botella', 2400, 24),
  draft('Cerveza nacional lata 330 ml', 'Cervezas', 'lata', 2600, 24),
  draft('Cerveza importada 355 ml', 'Cervezas', 'botella', 4500, 12),
  draft('Cerveza artesanal 330 ml', 'Cervezas', 'botella', 6000, 6),
  draft('Aguardiente tradicional 750 ml', 'Aguardientes', 'botella', 42000, 4),
  draft('Aguardiente sin azúcar 375 ml', 'Aguardientes', 'media botella', 23000, 4),
  draft('Ron añejo 750 ml', 'Rones', 'botella', 48000, 3),
  draft('Ron blanco 375 ml', 'Rones', 'media botella', 21000, 3),
  draft('Whisky 12 años 700 ml', 'Whiskies', 'botella', 95000, 2),
  draft('Whisky estándar 750 ml', 'Whiskies', 'botella', 62000, 2),
  draft('Vodka 750 ml', 'Vodkas', 'botella', 45000, 2),
  draft('Tequila reposado 750 ml', 'Tequilas', 'botella', 85000, 2),
  draft('Gaseosa cola 400 ml', 'Gaseosas', 'botella', 1800, 24),
  draft('Gaseosa naranja 400 ml', 'Gaseosas', 'botella', 1700, 12),
  draft('Soda 300 ml', 'Gaseosas', 'botella', 1500, 12),
  draft('Agua sin gas 600 ml', 'Aguas', 'botella', 1200, 12),
  draft('Agua con gas 600 ml', 'Aguas', 'botella', 1400, 6),
  draft('Bebida energizante 250 ml', 'Energizantes', 'lata', 3800, 12),
  draft('Jugo de naranja 300 ml', 'Jugos', 'botella', 2200, 6),
  draft('Limonada natural', 'Jugos', 'vaso', 1500, 0),
  draft('Papas fritas 45 g', 'Snacks', 'paquete', 1600, 12),
  draft('Maní salado 50 g', 'Snacks', 'paquete', 1200, 12),
  draft('Chicles', 'Snacks', 'paquete', 400, 20),
  draft('Hielo', 'Otros', 'paquete', 2000, 5),
]

function draft(
  name: string,
  categoryName: string,
  unit: Unit,
  cost: Cop,
  minStock: number,
): ProductDraft {
  return {
    name,
    description: 'Producto de ejemplo con costo ficticio.',
    categoryName,
    unit,
    cost,
    minStock,
    manualPrice: null,
    markupBp: null,
  }
}
