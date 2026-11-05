import { describe, expect, it } from 'vitest'
import { aggregate } from '@/domain/metrics/sales-report'
import { daySummaryText } from '../domain/day-summary'

describe('resumen de la jornada (D-221)', () => {
  it('trae lo vendido, lo abierto, lo cobrado por medio y el top', () => {
    const t = aggregate([
      {
        salesGross: 27_000,
        cogs: 12_000,
        ordersCount: 3,
        collected: 27_000,
        byMethod: { efectivo: 18_000, transferencia: 9_000 },
        byChannel: { nequi: 9_000 },
        invLosses: 2_400,
        byProduct: {
          aguila: { name: 'Águila', categoryId: 'c', qty: 4, sales: 18_000, cogs: 9_600 },
          ron: { name: 'Ron', categoryId: 'r', qty: 1, sales: 9_000, cogs: 2_400 },
        },
      },
    ])
    const text = daySummaryText('Kmilo Bar', '2026-11-06', t, {
      count: 1,
      total: 13_500,
    }).replace(/ /g, ' ')
    expect(text).toContain('viernes 6 de noviembre')
    expect(text).toContain('Vendido (pagado): $ 27.000 (3 cuentas)')
    expect(text).toContain('En cuentas abiertas: $ 13.500 (1 cuenta)')
    expect(text).toContain('*Total: $ 40.500*')
    expect(text).toContain('- Efectivo: $ 18.000')
    expect(text).toContain('- Nequi: $ 9.000')
    expect(text).toContain('Pérdidas: $ 2.400')
    expect(text).toContain('1. Águila × 4: $ 18.000')
  })
})
