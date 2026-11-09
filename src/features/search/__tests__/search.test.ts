import { describe, expect, it } from 'vitest'
import { buildSearchIndex, normalizeText, searchItems } from '../domain/search'

const index = buildSearchIndex({
  products: [
    { id: 'p1', name: 'Club Colombia', categoryName: 'Cervezas', stock: 12, active: true },
    { id: 'p2', name: 'Ron Viejo de Caldas', categoryName: 'Rones', stock: 0, active: true },
    { id: 'p3', name: 'Descontinuado', categoryName: 'Otros', stock: 0, active: false },
  ],
  suppliers: [{ id: 's1', name: 'Distribución Andina', active: true }],
  orders: [{ id: 'o1', number: 7, title: 'Mesa 3', status: 'por_cobrar' }],
})

describe('búsqueda global (F9-04)', () => {
  it('ignora mayúsculas y tildes', () => {
    expect(normalizeText('Distribución')).toBe('distribucion')
    expect(searchItems('DISTRIBUCION', index).map((i) => i.id)).toEqual(['s1'])
  })
  it('cada palabra debe aparecer', () => {
    expect(searchItems('club colombia', index).map((i) => i.id)).toEqual(['p1'])
    expect(searchItems('club viejo', index)).toEqual([])
  })
  it('encuentra cuentas por mesa o número, con su ruta', () => {
    const hit = searchItems('mesa 3', index)[0]
    expect(hit).toMatchObject({ kind: 'cuenta', to: '/cuentas/o1' })
    expect(hit?.subtitle).toBe('Cuenta #7 · por cobrar')
  })
  it('no muestra productos desactivados ni busca cuando está vacío', () => {
    expect(searchItems('descontinuado', index)).toEqual([])
    expect(searchItems('   ', index)).toEqual([])
  })
  it('las rutas de productos y proveedores llevan a su ficha', () => {
    expect(searchItems('ron', index)[0]?.to).toBe('/productos/p2')
    expect(searchItems('andina', index)[0]?.to).toBe('/proveedores/s1')
  })
})
