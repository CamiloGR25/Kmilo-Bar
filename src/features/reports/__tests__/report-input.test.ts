import { describe, expect, it } from 'vitest'
import { buildReportInput, type RawDocs } from '../domain/report-input'

const empty: RawDocs = {
  dailyStats: [],
  products: [],
  categories: [],
  inventoryMovements: [],
  expenses: [],
  receptions: [],
  supplierPayments: [],
  suppliers: [],
  cashSessions: [],
}

describe('buildReportInput (datos del motor de reportes)', () => {
  it('une cada producto con el nombre de su categoría', () => {
    const input = buildReportInput(
      { from: '2026-11-01', to: '2026-11-09' },
      {
        ...empty,
        categories: [{ id: 'cerv', data: { name: 'Cervezas' } }],
        products: [
          {
            id: 'p1',
            data: {
              name: 'Club',
              categoryId: 'cerv',
              stock: 3,
              avgCost: 2500,
              salePrice: 3000,
              active: true,
              minStock: 4,
            },
          },
        ],
      },
    )
    expect(input.products[0]).toMatchObject({
      name: 'Club',
      categoryName: 'Cervezas',
      stock: 3,
      active: true,
    })
  })

  it('no toma los gastos anulados', () => {
    const input = buildReportInput(
      { from: '2026-11-01', to: '2026-11-09' },
      {
        ...empty,
        expenses: [
          {
            id: 'e1',
            data: {
              categoryName: 'Luz',
              kind: 'variable',
              amount: 80_000,
              status: 'activo',
              businessDate: '2026-11-05',
            },
          },
          {
            id: 'e2',
            data: {
              categoryName: 'Luz',
              kind: 'variable',
              amount: 99_000,
              status: 'anulado',
              businessDate: '2026-11-05',
            },
          },
        ],
      },
    )
    expect(input.expenses.map((e) => e.amount)).toEqual([80_000])
  })

  it('toma las ventas del día y el resumen de cada caja cerrada', () => {
    const input = buildReportInput(
      { from: '2026-11-09', to: '2026-11-09' },
      {
        ...empty,
        dailyStats: [
          { id: '2026-11-09', data: { salesGross: 50_000, cogs: 20_000, ordersCount: 2 } },
        ],
        cashSessions: [
          {
            id: 'cs1',
            data: {
              businessDate: '2026-11-09',
              number: 1,
              status: 'cerrada',
              openingBalance: 50_000,
              summary: { sales: 50_000 },
              expectedCash: 100_000,
              countedCash: 100_000,
              difference: 0,
            },
          },
        ],
      },
    )
    expect(input.days[0]).toMatchObject({
      businessDate: '2026-11-09',
      salesGross: 50_000,
      ordersCount: 2,
    })
    expect(input.sessions[0]).toMatchObject({ status: 'cerrada', sales: 50_000, difference: 0 })
  })

  it('lee la marca de tiempo de un movimiento cuando trae toDate', () => {
    const input = buildReportInput(
      { from: '2026-11-09', to: '2026-11-09' },
      {
        ...empty,
        inventoryMovements: [
          {
            id: 'm1',
            data: {
              businessDate: '2026-11-09',
              productName: 'Club',
              type: 'venta',
              qty: -1,
              createdAt: { toDate: () => new Date('2026-11-09T12:00:00Z') },
            },
          },
        ],
      },
    )
    expect(input.movements[0]?.createdAtMs).toBe(Date.parse('2026-11-09T12:00:00Z'))
  })
})
