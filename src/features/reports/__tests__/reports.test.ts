import { describe, expect, it } from 'vitest'
import {
  buildReport,
  dayList,
  formatCell,
  MAX_REPORT_DAYS,
  rangeFor,
  validateCustomRange,
  type DayRecord,
  type ReportInput,
  type ReportTable,
} from '../domain/reports'
import { fileNameFor, reportToCsv } from '../services/export'

// 2026-11-02 y 2026-11-09 son lunes de semanas distintas.
const days: DayRecord[] = [
  {
    businessDate: '2026-11-02',
    salesGross: 100_000,
    cogs: 40_000,
    ordersCount: 3,
    collected: 100_000,
    invLosses: 5_000,
    byProduct: { p1: { name: 'Club', categoryId: 'cerv', qty: 10, sales: 100_000, cogs: 40_000 } },
  },
  {
    businessDate: '2026-11-09',
    salesGross: 50_000,
    cogs: 20_000,
    ordersCount: 2,
    collected: 50_000,
    byProduct: {
      p1: { name: 'Club', categoryId: 'cerv', qty: 5, sales: 50_000, cogs: 20_000 },
      p2: { name: 'Ron', categoryId: 'ron', qty: 1, sales: 30_000, cogs: 10_000 },
    },
  },
]

const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  range: { from: '2026-11-02', to: '2026-11-09' },
  days,
  products: [
    {
      id: 'p1',
      name: 'Club',
      categoryId: 'cerv',
      categoryName: 'Cervezas',
      stock: 10,
      minStock: 4,
      avgCost: 1_000,
      salePrice: 3_000,
      active: true,
    },
    {
      id: 'p9',
      name: 'Inactivo',
      categoryId: 'cerv',
      categoryName: 'Cervezas',
      stock: 99,
      minStock: 1,
      avgCost: 1,
      salePrice: 1,
      active: false,
    },
  ],
  movements: [],
  expenses: [],
  receptions: [],
  supplierPayments: [],
  suppliers: [],
  sessions: [],
  ...over,
})

const rowAt = (t: ReportTable, i: number): Record<string, unknown> => t.rows[i] ?? {}

describe('periodos', () => {
  it('lista las jornadas del rango, inclusive', () => {
    expect(dayList({ from: '2026-11-08', to: '2026-11-10' })).toEqual([
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
    ])
  })
  it('presets: hoy, últimos 7 días, este mes y mes anterior', () => {
    expect(rangeFor('hoy', '2026-11-09')).toEqual({ from: '2026-11-09', to: '2026-11-09' })
    expect(rangeFor('semana', '2026-11-09')).toEqual({ from: '2026-11-03', to: '2026-11-09' })
    expect(rangeFor('mes', '2026-11-09')).toEqual({ from: '2026-11-01', to: '2026-11-09' })
    expect(rangeFor('mes_anterior', '2026-11-09')).toEqual({ from: '2026-10-01', to: '2026-10-31' })
  })
  it('valida el periodo elegido a mano', () => {
    expect(validateCustomRange('2026-11-10', '2026-11-01')).toMatch(/posterior/)
    expect(validateCustomRange('2025-01-01', '2026-11-01')).toMatch(String(MAX_REPORT_DAYS))
    expect(validateCustomRange('2026-11-01', '2026-11-09')).toBeNull()
    expect(validateCustomRange('', '2026-11-09')).toMatch(/fechas/)
  })
})

describe('ventas (diarias, semanales, mensuales)', () => {
  it('diarias: una fila por jornada, con utilidad y pérdidas', () => {
    const t = buildReport('ventas_diarias', input())
    expect(t.rows).toHaveLength(8)
    expect(rowAt(t, 0).vendido).toBe(100_000)
    expect(rowAt(t, 0).utilidad).toBe(60_000)
    expect(rowAt(t, 0).perdidas).toBe(5_000)
    expect(t.totals?.vendido).toBe(150_000)
  })
  it('semanales: separa las semanas por lunes', () => {
    const t = buildReport('ventas_semanales', input())
    expect(t.rows).toHaveLength(2)
    expect(rowAt(t, 0).vendido).toBe(100_000)
    expect(rowAt(t, 1).vendido).toBe(50_000)
    expect(rowAt(t, 0).periodo).toBe('2026-11-02 a 2026-11-08')
  })
  it('mensuales: un mes con el total del periodo', () => {
    const t = buildReport('ventas_mensuales', input())
    expect(t.rows).toEqual([
      expect.objectContaining({ periodo: '2026-11', vendido: 150_000, cuentas: 5 }),
    ])
  })
})

describe('productos', () => {
  it('más vendidos: de mayor a menor cantidad; menos vendidos al revés', () => {
    expect(rowAt(buildReport('mas_vendidos', input()), 0).producto).toBe('Club')
    expect(rowAt(buildReport('menos_vendidos', input()), 0).producto).toBe('Ron')
  })
  it('rentabilidad: margen y orden por utilidad', () => {
    const t = buildReport('rentabilidad', input())
    expect(rowAt(t, 0)).toMatchObject({
      producto: 'Club',
      ventas: 150_000,
      costo: 60_000,
      utilidad: 90_000,
      margen: 60,
    })
    expect(t.totals?.margen).toBe(61.1)
  })
})

describe('inventario', () => {
  it('valor a costo y a venta, sin productos desactivados', () => {
    const t = buildReport('inventario_actual', input())
    expect(t.rows).toHaveLength(1)
    expect(rowAt(t, 0)).toMatchObject({ valorCosto: 10_000, valorVenta: 30_000 })
    expect(t.totals).toMatchObject({ valorCosto: 10_000, valorVenta: 30_000 })
  })
  it('movimientos en orden cronológico con su tipo en español', () => {
    const t = buildReport(
      'movimientos_inventario',
      input({
        movements: [
          {
            businessDate: '2026-11-09',
            productName: 'Club',
            type: 'venta',
            qty: -2,
            stockBefore: 10,
            stockAfter: 8,
            unitCost: 1000,
            reason: null,
            createdAtMs: 2,
          },
          {
            businessDate: '2026-11-02',
            productName: 'Club',
            type: 'entrada_compra',
            qty: 10,
            stockBefore: 0,
            stockAfter: 10,
            unitCost: 1000,
            reason: null,
            createdAtMs: 1,
          },
        ],
      }),
    )
    expect(t.rows.map((r) => r.stockDespues)).toEqual([10, 8])
    expect(rowAt(t, 0).tipo).not.toBe('entrada_compra')
  })
})

describe('gastos, compras y caja', () => {
  it('gastos: total y tipo de pago', () => {
    const t = buildReport(
      'gastos',
      input({
        expenses: [
          {
            businessDate: '2026-11-05',
            categoryName: 'Arriendo',
            kind: 'fijo',
            amount: 800_000,
            method: 'transferencia',
            fromCash: false,
            description: '',
          },
          {
            businessDate: '2026-11-06',
            categoryName: 'Luz',
            kind: 'variable',
            amount: 80_000,
            method: 'efectivo',
            fromCash: true,
            description: 'Enel',
          },
        ],
      }),
    )
    expect(t.totals?.monto).toBe(880_000)
    expect(rowAt(t, 0).pago).toBe('De la caja')
  })
  it('compras por proveedor: recibido y pagado en el periodo', () => {
    const t = buildReport(
      'compras_proveedor',
      input({
        suppliers: [{ id: 's1', name: 'Distribuidora' }],
        receptions: [{ supplierId: 's1', businessDate: '2026-11-03', total: 300_000 }],
        supplierPayments: [{ supplierId: 's1', businessDate: '2026-11-04', amount: 100_000 }],
      }),
    )
    expect(rowAt(t, 0)).toMatchObject({
      proveedor: 'Distribuidora',
      recibido: 300_000,
      pagado: 100_000,
    })
  })
  it('cierres: solo cajas cerradas, con diferencia', () => {
    const t = buildReport(
      'cierres_caja',
      input({
        sessions: [
          {
            businessDate: '2026-11-02',
            number: 1,
            openingBalance: 50_000,
            status: 'cerrada',
            sales: 100_000,
            expectedCash: 150_000,
            countedCash: 149_000,
            difference: -1_000,
            differenceReason: 'Vuelto',
          },
          {
            businessDate: '2026-11-09',
            number: 2,
            openingBalance: 50_000,
            status: 'abierta',
            sales: 0,
            expectedCash: null,
            countedCash: null,
            difference: null,
            differenceReason: null,
          },
        ],
      }),
    )
    expect(t.rows).toHaveLength(1)
    expect(t.totals?.diferencia).toBe(-1_000)
  })
  it('resumen financiero: mismas fórmulas que Finanzas', () => {
    const t = buildReport('resumen_financiero', input())
    const value = (c: string) => t.rows.find((r) => r.concepto === c)?.valor
    expect(value('Ventas')).toBe(150_000)
    expect(value('Utilidad bruta')).toBe(90_000)
  })
})

describe('exportación y formato', () => {
  it('CSV con BOM, separador ";" y cifras sin separador de miles', () => {
    const csv = reportToCsv(buildReport('ventas_mensuales', input()))
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('Mes;Cuentas;Vendido')
    expect(csv).toContain('2026-11;5;150000')
  })
  it('CSV escapa celdas con ";" o comillas', () => {
    const csv = reportToCsv(
      buildReport(
        'gastos',
        input({
          expenses: [
            {
              businessDate: '2026-11-05',
              categoryName: 'Otros',
              kind: 'variable',
              amount: 1000,
              method: 'efectivo',
              fromCash: false,
              description: 'Pan; "fresco"',
            },
          ],
        }),
      ),
    )
    expect(csv).toContain('"Pan; ""fresco"""')
  })
  it('porcentajes con coma y vacíos como guion', () => {
    expect(formatCell(31.2, 'pct')).toBe('31,2 %')
    expect(formatCell(null, 'cop')).toBe('—')
  })
  it('nombre de archivo seguro', () => {
    const t = buildReport('ventas_diarias', input())
    expect(fileNameFor(t, 'xlsx')).toBe('ventas-diarias-del-2026-11-02-al-2026-11-09.xlsx')
  })
})
