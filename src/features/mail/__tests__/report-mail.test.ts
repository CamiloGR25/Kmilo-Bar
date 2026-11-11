import { describe, expect, it } from 'vitest'
import {
  buildReport,
  type DayRecord,
  type ReportInput,
  type ReportTable,
} from '@/features/reports/domain/reports'
import { reportToCsv, fileNameFor } from '@/features/reports/services/export'
import { buildReportMail, mailRange } from '../domain/report-mail'

describe('periodo del correo (M11)', () => {
  it('el semanal del lunes cubre la semana anterior completa', () => {
    // 2026-11-09 es lunes: la semana anterior va del 2026-11-02 al 2026-11-08.
    expect(mailRange('semanal', '2026-11-09')).toEqual({ from: '2026-11-02', to: '2026-11-08' })
  })
  it('el mensual del día 1 cubre el mes anterior completo', () => {
    expect(mailRange('mensual', '2026-12-01')).toEqual({ from: '2026-11-01', to: '2026-11-30' })
  })
})

describe('correo de reportes', () => {
  const days: DayRecord[] = [
    {
      businessDate: '2026-11-02',
      salesGross: 100_000,
      cogs: 40_000,
      ordersCount: 3,
      collected: 100_000,
      expensesFixed: 30_000,
    },
    {
      businessDate: '2026-11-03',
      salesGross: 50_000,
      cogs: 20_000,
      ordersCount: 2,
      collected: 50_000,
    },
  ]
  const range = { from: '2026-11-02', to: '2026-11-08' }
  const input: ReportInput = {
    range,
    days,
    products: [],
    movements: [],
    expenses: [
      {
        businessDate: '2026-11-02',
        categoryName: 'Arriendo',
        kind: 'fijo',
        amount: 30_000,
        method: 'transferencia',
        fromCash: false,
        description: '',
      },
    ],
    receptions: [],
    supplierPayments: [],
    suppliers: [],
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
    ],
  }
  const tables: ReportTable[] = [
    'resumen_financiero',
    'ventas_semanales',
    'gastos',
    'cierres_caja',
    'compras_proveedor',
  ].map((id) => buildReport(id as Parameters<typeof buildReport>[0], input))
  const mail = buildReportMail({
    kind: 'semanal',
    range,
    tables,
    csvOf: reportToCsv,
    filenameOf: (t) => fileNameFor(t, 'csv'),
  })

  it('el asunto lleva el tipo de resumen y el periodo', () => {
    expect(mail.subject).toBe('Kmilo Bar · Resumen semanal · 2026-11-02 a 2026-11-08')
  })

  it('muestra las cifras clave en el HTML y el texto', () => {
    expect(mail.html).toMatch(/150.000/)
    expect(mail.text).toMatch(/Vendido: .*150.000/)
    expect(mail.text).toContain('Cierres de caja con diferencia: 1')
  })

  it('adjunta un CSV por reporte incluido', () => {
    const names = mail.attachments.map((a) => a.filename)
    expect(names).toHaveLength(5)
    expect(names.some((n) => n.startsWith('gastos-'))).toBe(true)
    expect(names.some((n) => n.startsWith('cierres-caja-'))).toBe(true)
    expect(names.every((n) => n.endsWith('.csv'))).toBe(true)
    expect(mail.attachments[0]?.csv.startsWith('﻿')).toBe(true)
  })

  it('escapa el HTML del texto de la tabla', () => {
    const t = buildReport('gastos', {
      ...input,
      expenses: [{ ...input.expenses[0]!, description: '<script>x</script>' }],
    })
    const m = buildReportMail({
      kind: 'semanal',
      range,
      tables: [t],
      csvOf: reportToCsv,
      filenameOf: (x) => fileNameFor(x, 'csv'),
    })
    expect(m.html).not.toContain('<script>')
  })
})
