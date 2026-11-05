/**
 * Acceso a Firestore para categorías, productos e historial de precios (Fase 2).
 * Toda escritura va en un batch junto con su historial y su auditoría (R-AUD-01).
 * En esta fase el stock se crea en 0 y no se modifica aquí (lo hará el inventario, Fase 3).
 */
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
  limit,
  type WriteBatch,
} from 'firebase/firestore'
import { computePricing } from '@/domain/metrics/pricing'
import { db } from '@/lib/firebase/firestore'
import { toDate, useSubscription } from '@/lib/firebase/use-subscription'
import { addAudit, changedFields } from '@/features/audit/services/audit'
import type { Settings } from '@/features/settings/domain/settings'
import {
  categoryIdFromName,
  CATEGORY_ICONS,
  type Category,
  type CategoryIcon,
  type Product,
  type ProductDraft,
  type Unit,
} from '../domain/catalog'
import type { ProductFormValues } from '../schemas/product-schema'

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export function useCategories() {
  return useSubscription<Category[]>(
    (onData, onError) =>
      onSnapshot(
        query(collection(db, 'categories'), orderBy('sortOrder')),
        (snap) =>
          onData(
            snap.docs.map((d) => {
              const x = d.data()
              return {
                id: d.id,
                name: String(x.name ?? ''),
                icon: (CATEGORY_ICONS as readonly string[]).includes(x.icon)
                  ? (x.icon as CategoryIcon)
                  : 'package',
                active: x.active !== false,
                sortOrder: Number(x.sortOrder ?? 0),
              }
            }),
          ),
        onError,
      ),
    'categories',
  )
}

export function productFromDoc(id: string, x: Record<string, unknown>): Product {
  return {
    id,
    name: String(x.name ?? ''),
    description: String(x.description ?? ''),
    categoryId: String(x.categoryId ?? ''),
    unit: (x.unit as Unit) ?? 'unidad',
    stock: Number(x.stock ?? 0),
    minStock: Number(x.minStock ?? 0),
    avgCost: Number(x.avgCost ?? 0),
    lastPurchaseCost: Number(x.lastPurchaseCost ?? 0),
    salePrice: Number(x.salePrice ?? 0),
    pricingMode: x.pricingMode === 'manual' ? 'manual' : 'auto',
    markupBp: typeof x.markupBp === 'number' ? x.markupBp : null,
    active: x.active !== false,
    createdAt: toDate(x.createdAt),
    updatedAt: toDate(x.updatedAt),
  }
}

/** Todos los productos (el catálogo de un bar pequeño cabe cómodo en memoria). */
export function useProducts() {
  return useSubscription<Product[]>(
    (onData, onError) =>
      onSnapshot(
        query(collection(db, 'products'), orderBy('name')),
        (snap) => onData(snap.docs.map((d) => productFromDoc(d.id, d.data()))),
        onError,
      ),
    'products',
  )
}

export interface PriceHistoryEntry {
  id: string
  field: 'salePrice' | 'avgCost' | 'markupBp'
  oldValue: number | null
  newValue: number | null
  source: 'creacion' | 'manual' | 'recalculo' | 'importacion'
  reason: string | null
  at: Date | null
}

export function usePriceHistory(productId: string | undefined) {
  return useSubscription<PriceHistoryEntry[]>(
    (onData, onError) => {
      if (!productId) {
        onData([])
        return () => {}
      }
      return onSnapshot(
        query(
          collection(db, 'priceHistory'),
          where('productId', '==', productId),
          orderBy('at', 'desc'),
          limit(50),
        ),
        (snap) =>
          onData(
            snap.docs.map((d) => {
              const x = d.data()
              return {
                id: d.id,
                field: x.field,
                oldValue: x.oldValue ?? null,
                newValue: x.newValue ?? null,
                source: x.source,
                reason: x.reason ?? null,
                at: toDate(x.at),
              }
            }),
          ),
        onError,
      )
    },
    `priceHistory/${productId ?? ''}`,
  )
}

// ---------------------------------------------------------------------------
// Categorías
// ---------------------------------------------------------------------------

export async function saveCategory(
  uid: string,
  input: { name: string; icon: CategoryIcon },
  existing: Category | null,
  all: Category[],
) {
  const batch = writeBatch(db)
  if (existing) {
    const diff = changedFields(
      { name: existing.name, icon: existing.icon },
      { name: input.name, icon: input.icon },
    )
    if (!diff) return
    batch.update(doc(db, 'categories', existing.id), input)
    addAudit(db, batch, uid, {
      action: 'actualizar',
      entity: 'category',
      entityId: existing.id,
      summary: `Categoría "${input.name}" actualizada`,
      ...diff,
    })
  } else {
    const id = uniqueCategoryId(input.name, all)
    const sortOrder = Math.max(0, ...all.map((c) => c.sortOrder)) + 1
    batch.set(doc(db, 'categories', id), { ...input, active: true, sortOrder })
    addAudit(db, batch, uid, {
      action: 'crear',
      entity: 'category',
      entityId: id,
      summary: `Categoría "${input.name}" creada`,
    })
  }
  await batch.commit()
}

export async function setCategoryActive(uid: string, category: Category, active: boolean) {
  const batch = writeBatch(db)
  batch.update(doc(db, 'categories', category.id), { active })
  addAudit(db, batch, uid, {
    action: active ? 'activar' : 'desactivar',
    entity: 'category',
    entityId: category.id,
    summary: `Categoría "${category.name}" ${active ? 'activada' : 'desactivada'}`,
    before: { active: category.active },
    after: { active },
  })
  await batch.commit()
}

/** Intercambia el orden de dos categorías. */
export async function swapCategoryOrder(a: Category, b: Category) {
  const batch = writeBatch(db)
  batch.update(doc(db, 'categories', a.id), { sortOrder: b.sortOrder })
  batch.update(doc(db, 'categories', b.id), { sortOrder: a.sortOrder })
  await batch.commit()
}

function uniqueCategoryId(name: string, all: Category[]): string {
  const base = categoryIdFromName(name) || 'categoria'
  const ids = new Set(all.map((c) => c.id))
  let id = base
  for (let n = 2; ids.has(id); n++) id = `${base}-${n}`
  return id
}

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------

type PriceField = PriceHistoryEntry['field']

function addPriceHistory(
  batch: WriteBatch,
  productId: string,
  field: PriceField,
  oldValue: number | null,
  newValue: number | null,
  source: PriceHistoryEntry['source'],
  reason: string | null = null,
) {
  batch.set(doc(collection(db, 'priceHistory')), {
    productId,
    field,
    oldValue,
    newValue,
    source,
    reason,
    at: serverTimestamp(),
  })
}

/** Valores que se guardan para un producto a partir del formulario. */
function productFields(values: ProductFormValues, settings: Settings) {
  const pricing = computePricing(
    {
      cost: values.cost,
      pricingMode: values.pricingMode,
      markupBp: values.markupMode === 'custom' ? values.markupBp : null,
      manualPrice: values.pricingMode === 'manual' ? values.manualPrice : null,
    },
    settings,
  )
  return {
    name: values.name.trim(),
    description: values.description.trim(),
    categoryId: values.categoryId,
    unit: values.unit,
    minStock: values.minStock,
    avgCost: values.cost,
    salePrice: pricing.salePrice,
    pricingMode: values.pricingMode,
    markupBp: values.markupMode === 'custom' ? values.markupBp : null,
    active: values.active,
  }
}

export async function createProduct(uid: string, values: ProductFormValues, settings: Settings) {
  const ref = doc(collection(db, 'products'))
  const fields = productFields(values, settings)
  const batch = writeBatch(db)
  batch.set(ref, {
    ...fields,
    stock: 0,
    lastPurchaseCost: fields.avgCost,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  addPriceHistory(batch, ref.id, 'salePrice', null, fields.salePrice, 'creacion')
  addPriceHistory(batch, ref.id, 'avgCost', null, fields.avgCost, 'creacion')
  addAudit(db, batch, uid, {
    action: 'crear',
    entity: 'product',
    entityId: ref.id,
    summary: `Producto "${fields.name}" creado`,
    after: { salePrice: fields.salePrice, avgCost: fields.avgCost },
  })
  await batch.commit()
  return ref.id
}

export async function updateProduct(
  uid: string,
  product: Product,
  values: ProductFormValues,
  settings: Settings,
  reason: string | null,
) {
  // El estado activo se cambia solo con setProductActive (interruptor con confirmación).
  const fields = { ...productFields(values, settings), active: product.active }
  if (fields.avgCost !== product.avgCost && product.stock > 0) {
    // R: con stock, el costo solo cambia por recepciones o ajustes de inventario (D-105).
    throw new Error('El costo solo se puede editar cuando el producto no tiene stock.')
  }
  const before = {
    name: product.name,
    description: product.description,
    categoryId: product.categoryId,
    unit: product.unit,
    minStock: product.minStock,
    avgCost: product.avgCost,
    salePrice: product.salePrice,
    pricingMode: product.pricingMode,
    markupBp: product.markupBp,
    active: product.active,
  }
  const diff = changedFields(before, fields)
  if (!diff) return

  const batch = writeBatch(db)
  batch.update(doc(db, 'products', product.id), {
    ...fields,
    ...(fields.avgCost !== product.avgCost ? { lastPurchaseCost: fields.avgCost } : {}),
    updatedAt: serverTimestamp(),
  })
  for (const field of ['salePrice', 'avgCost', 'markupBp'] as const) {
    if (product[field] !== fields[field]) {
      addPriceHistory(batch, product.id, field, product[field], fields[field], 'manual', reason)
    }
  }
  addAudit(db, batch, uid, {
    action: 'actualizar',
    entity: 'product',
    entityId: product.id,
    summary: `Producto "${fields.name}" actualizado`,
    ...diff,
    reason,
  })
  await batch.commit()
}

export async function setProductActive(uid: string, product: Product, active: boolean) {
  const batch = writeBatch(db)
  batch.update(doc(db, 'products', product.id), { active, updatedAt: serverTimestamp() })
  addAudit(db, batch, uid, {
    action: active ? 'activar' : 'desactivar',
    entity: 'product',
    entityId: product.id,
    summary: `Producto "${product.name}" ${active ? 'activado' : 'desactivado'}`,
    before: { active: product.active },
    after: { active },
  })
  await batch.commit()
}

/** Productos automáticos cuyo precio ya no coincide con el sugerido (tras cambiar recargo o redondeo). */
export function outdatedAutoPrices(products: Product[], settings: Settings) {
  return products
    .filter((p) => p.pricingMode === 'auto')
    .map((p) => {
      const { suggested } = computePricing(
        { cost: p.avgCost, pricingMode: 'auto', markupBp: p.markupBp, manualPrice: null },
        settings,
      )
      return { product: p, suggested }
    })
    .filter(({ product, suggested }) => product.salePrice !== suggested)
}

/** Aplica el precio sugerido a los productos automáticos desactualizados. */
export async function applySuggestedPrices(
  uid: string,
  changes: { product: Product; suggested: number }[],
) {
  // 2 escrituras por producto + 1 auditoría; lotes de 200 productos (< 500 escrituras).
  for (let i = 0; i < changes.length; i += 200) {
    const chunk = changes.slice(i, i + 200)
    const batch = writeBatch(db)
    for (const { product, suggested } of chunk) {
      batch.update(doc(db, 'products', product.id), {
        salePrice: suggested,
        updatedAt: serverTimestamp(),
      })
      addPriceHistory(batch, product.id, 'salePrice', product.salePrice, suggested, 'recalculo')
    }
    addAudit(db, batch, uid, {
      action: 'recalcular-precios',
      entity: 'catalog',
      entityId: 'products',
      summary: `Precios automáticos recalculados (${chunk.length} productos)`,
    })
    await batch.commit()
  }
}

/**
 * Importa productos (CSV o catálogo de ejemplo). Crea las categorías que no existan y
 * omite los productos cuyo nombre ya existe. Devuelve cuántos creó y cuáles omitió.
 */
export async function importProducts(
  uid: string,
  drafts: ProductDraft[],
  categories: Category[],
  existing: Product[],
  settings: Settings,
  source: 'csv' | 'ejemplo',
) {
  const existingNames = new Set(existing.map((p) => p.name.trim().toLowerCase()))
  const skipped = drafts.filter((d) => existingNames.has(d.name.trim().toLowerCase()))
  const toCreate = drafts.filter((d) => !existingNames.has(d.name.trim().toLowerCase()))

  const byName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c]))
  const allCategories = [...categories]
  const newCategories: Category[] = []
  for (const d of toCreate) {
    const key = d.categoryName.trim().toLowerCase()
    if (!byName.has(key)) {
      const id = uniqueCategoryId(d.categoryName, allCategories)
      const cat: Category = {
        id,
        name: d.categoryName.trim(),
        icon: 'package',
        active: true,
        sortOrder: Math.max(0, ...allCategories.map((c) => c.sortOrder)) + 1,
      }
      byName.set(key, cat)
      allCategories.push(cat)
      newCategories.push(cat)
    }
  }

  // Categorías nuevas primero, luego productos en lotes (3 escrituras por producto).
  if (newCategories.length > 0) {
    const batch = writeBatch(db)
    for (const { id, ...data } of newCategories) batch.set(doc(db, 'categories', id), data)
    await batch.commit()
  }
  for (let i = 0; i < toCreate.length; i += 150) {
    const batch = writeBatch(db)
    for (const d of toCreate.slice(i, i + 150)) {
      const ref = doc(collection(db, 'products'))
      const pricing = computePricing(
        {
          cost: d.cost,
          pricingMode: d.manualPrice !== null ? 'manual' : 'auto',
          markupBp: d.markupBp,
          manualPrice: d.manualPrice,
        },
        settings,
      )
      batch.set(ref, {
        name: d.name,
        description: d.description,
        categoryId: byName.get(d.categoryName.trim().toLowerCase())!.id,
        unit: d.unit,
        stock: 0,
        minStock: d.minStock,
        avgCost: d.cost,
        lastPurchaseCost: d.cost,
        salePrice: pricing.salePrice,
        pricingMode: d.manualPrice !== null ? 'manual' : 'auto',
        markupBp: d.markupBp,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      addPriceHistory(batch, ref.id, 'salePrice', null, pricing.salePrice, 'importacion')
      addPriceHistory(batch, ref.id, 'avgCost', null, d.cost, 'importacion')
    }
    await batch.commit()
  }
  const batch = writeBatch(db)
  addAudit(db, batch, uid, {
    action: 'importar',
    entity: 'catalog',
    entityId: 'products',
    summary: `Importación (${source}): ${toCreate.length} productos, ${newCategories.length} categorías nuevas`,
  })
  await batch.commit()
  return { created: toCreate.length, skipped: skipped.map((d) => d.name), newCategories }
}
