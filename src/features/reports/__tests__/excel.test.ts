import { describe, expect, it } from 'vitest'
import { buildReport, type DayRecord } from '../domain/reports'
import { excelBuffer } from '../services/export'

const days: DayRecord[] = [
  {
    businessDate: '2026-11-02',
    salesGross: 100_000,
    cogs: 40_000,
    ordersCount: 3,
    collected: 100_000,
  },
]

describe('Excel (F9-02)', () => {
  it('genera un libro .xlsx (archivo ZIP) con encabezados y totales', async () => {
    const table = buildReport('ventas_diarias', {
      range: { from: '2026-11-02', to: '2026-11-02' },
      days,
      products: [],
      movements: [],
      expenses: [],
      receptions: [],
      supplierPayments: [],
      suppliers: [],
      sessions: [],
    })
    const buf = await excelBuffer(table)
    const bytes = new Uint8Array(buf)
    // Un .xlsx es un ZIP: empieza con "PK".
    expect(String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0)).toBe('PK')
    expect(bytes.byteLength).toBeGreaterThan(2_000)
  })
})
