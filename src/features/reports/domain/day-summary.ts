/**
 * Resumen de la jornada para WhatsApp o copiar (D-221): lo vendido, lo cobrado por medio, la
 * ganancia, las pérdidas y el top 5 de productos. Texto plano, sin impresora.
 */
import { formatBusinessDateLong, type BusinessDate } from '@/domain/dates'
import { topRows, productRows, type SalesTotals } from '@/domain/metrics/sales-report'
import { formatBp, formatCop } from '@/domain/money'
import { CHANNEL_LABELS, type TransferChannel } from '@/features/cash/domain/payments'

export interface OpenAccounts {
  count: number
  total: number
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function daySummaryText(
  businessName: string,
  date: BusinessDate,
  t: SalesTotals,
  open: OpenAccounts,
): string {
  const day = formatBusinessDateLong(date)
  const lines = [
    `*${businessName}*`,
    `Resumen de la jornada del ${day}`,
    '',
    `Vendido (pagado): ${formatCop(t.salesGross)} (${plural(t.ordersCount, 'cuenta', 'cuentas')})`,
  ]
  if (open.count > 0) {
    lines.push(
      `En cuentas abiertas: ${formatCop(open.total)} (${plural(open.count, 'cuenta', 'cuentas')})`,
      `*Total: ${formatCop(t.salesGross + open.total)}*`,
    )
  } else {
    lines.push(`*Total: ${formatCop(t.salesGross)}*`)
  }

  lines.push('', `Cobrado: ${formatCop(t.collected)}`)
  if (t.byMethod.efectivo) lines.push(`- Efectivo: ${formatCop(t.byMethod.efectivo)}`)
  for (const [channel, amount] of Object.entries(t.byChannel)) {
    if (amount)
      lines.push(`- ${CHANNEL_LABELS[channel as TransferChannel] ?? channel}: ${formatCop(amount)}`)
  }

  lines.push(
    '',
    `Ganancia bruta: ${formatCop(t.grossProfit)}${t.marginBp !== null ? ` (${formatBp(t.marginBp)})` : ''}`,
  )
  if (t.losses > 0) lines.push(`Pérdidas: ${formatCop(t.losses)}`)

  const top = topRows(productRows(t.byProduct), 'qty', 5)
  if (top.length > 0) {
    lines.push('', 'Más vendidos:')
    top.forEach((r, i) => lines.push(`${i + 1}. ${r.name} × ${r.qty}: ${formatCop(r.sales)}`))
  }
  return lines.join('\n')
}
