import { describe, expect, it } from 'vitest'
import { categoryIdFromName, INITIAL_CATEGORIES, SAMPLE_CATALOG } from '../domain/catalog'
import { importTemplateCsv, parseProductCsv } from '../domain/import'

describe('catálogo', () => {
  it('tiene las 12 categorías iniciales confirmadas', () => {
    expect(INITIAL_CATEGORIES.map((c) => c.name)).toEqual([
      'Cervezas',
      'Aguardientes',
      'Rones',
      'Whiskies',
      'Vodkas',
      'Tequilas',
      'Gaseosas',
      'Aguas',
      'Energizantes',
      'Jugos',
      'Snacks',
      'Otros',
    ])
  })
  it('genera IDs estables de categoría', () => {
    expect(categoryIdFromName('Energizantes')).toBe('energizantes')
    expect(categoryIdFromName(' Vinos & Más ')).toBe('vinos-mas')
  })
  it('el catálogo de ejemplo usa solo categorías existentes y costos enteros', () => {
    const names = new Set(INITIAL_CATEGORIES.map((c) => c.name))
    for (const p of SAMPLE_CATALOG) {
      expect(names.has(p.categoryName)).toBe(true)
      expect(Number.isSafeInteger(p.cost)).toBe(true)
    }
  })
})

describe('importación CSV', () => {
  it('lee la plantilla sin errores', () => {
    const r = parseProductCsv(importTemplateCsv())
    expect(r.fileErrors).toEqual([])
    expect(r.rows[0]?.draft).toMatchObject({
      name: 'Cerveza nacional 330 ml',
      categoryName: 'Cervezas',
      cost: 2400,
      unit: 'botella',
      minStock: 24,
      manualPrice: null,
      markupBp: null,
    })
  })
  it('acepta encabezados con tildes y montos con puntos de miles', () => {
    const csv =
      'Nombre;Categoría;Costo;Precio;Recargo\nRon;Rones;48.000;$ 75.000;\nVodka;Vodkas;45000;;60%'
    const r = parseProductCsv(csv)
    expect(r.rows.map((x) => x.errors)).toEqual([[], []])
    expect(r.rows[0]?.draft).toMatchObject({ cost: 48000, manualPrice: 75000 })
    expect(r.rows[1]?.draft).toMatchObject({ cost: 45000, markupBp: 6000, unit: 'unidad' })
  })
  it('reporta errores por línea sin frenar las demás filas', () => {
    const csv =
      'nombre,categoria,costo,unidad,stock_minimo\n,Cervezas,100,,\nSoda,Aguas,abc,litro,2.5\nAgua,Aguas,1200,,\nagua,Aguas,1300,,'
    const r = parseProductCsv(csv)
    expect(r.rows[0]).toMatchObject({ line: 2, draft: null })
    expect(r.rows[0]?.errors).toContain('Falta el nombre')
    expect(r.rows[1]?.errors).toEqual(
      expect.arrayContaining([
        'El costo no es un monto válido',
        'Unidad desconocida "litro"',
        'El stock mínimo debe ser un número entero',
      ]),
    )
    expect(r.rows[2]?.draft?.name).toBe('Agua')
    expect(r.rows[3]?.errors).toContain('Producto repetido en el archivo')
  })
  it('exige las columnas obligatorias', () => {
    expect(parseProductCsv('nombre,precio\nX,100').fileErrors[0]).toMatch(/categoria, costo/)
    expect(parseProductCsv('').fileErrors[0]).toMatch(/vacío/)
  })
})
