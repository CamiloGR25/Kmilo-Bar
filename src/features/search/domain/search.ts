/**
 * Búsqueda global (Fase 9, F9-04). Lógica pura: arma un índice con productos, proveedores y
 * cuentas, y filtra por texto sin importar mayúsculas ni tildes. Cada resultado lleva su ruta.
 */

export type SearchKind = 'producto' | 'cuenta' | 'proveedor'

export interface SearchItem {
  kind: SearchKind
  id: string
  title: string
  subtitle: string
  to: string
}

export const KIND_LABELS: Record<SearchKind, string> = {
  producto: 'Producto',
  cuenta: 'Cuenta',
  proveedor: 'Proveedor',
}

/** Texto sin tildes y en minúsculas, para comparar. */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

export interface SearchSource {
  products: readonly {
    id: string
    name: string
    categoryName: string
    stock: number
    active: boolean
  }[]
  suppliers: readonly { id: string; name: string; active: boolean }[]
  orders: readonly { id: string; number: number; title: string; status: string }[]
}

/** Índice de búsqueda a partir de los datos vivos. Los productos desactivados no aparecen. */
export function buildSearchIndex(src: SearchSource): SearchItem[] {
  const products: SearchItem[] = src.products
    .filter((p) => p.active)
    .map((p) => ({
      kind: 'producto',
      id: p.id,
      title: p.name,
      subtitle: `${p.categoryName} · stock ${p.stock}`,
      to: `/productos/${p.id}`,
    }))
  const suppliers: SearchItem[] = src.suppliers
    .filter((s) => s.active)
    .map((s) => ({
      kind: 'proveedor',
      id: s.id,
      title: s.name,
      subtitle: 'Proveedor',
      to: `/proveedores/${s.id}`,
    }))
  const orders: SearchItem[] = src.orders.map((o) => ({
    kind: 'cuenta',
    id: o.id,
    title: o.title,
    subtitle: `Cuenta #${o.number} · ${o.status.replace(/_/g, ' ')}`,
    to: `/cuentas/${o.id}`,
  }))
  return [...orders, ...products, ...suppliers]
}

/**
 * Filtra el índice: cada palabra de la búsqueda debe aparecer en el título, el subtítulo o el
 * tipo. Las cuentas van primero (son lo que más se busca en la jornada).
 */
export function searchItems(query: string, index: readonly SearchItem[], max = 12): SearchItem[] {
  const words = normalizeText(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  return index
    .filter((item) => {
      const hay = normalizeText(`${item.title} ${item.subtitle} ${KIND_LABELS[item.kind]}`)
      return words.every((w) => hay.includes(w))
    })
    .slice(0, max)
}
