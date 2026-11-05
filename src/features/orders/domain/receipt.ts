/**
 * Resumen de la cuenta para el cliente (D-219): texto plano para compartir por WhatsApp o
 * copiar. Sin impresora y sin desglose de impuestos (D-109).
 */
import { formatCop } from '@/domain/money'
import { groupLines, orderTitle, type Order } from './orders'

export interface ReceiptPayment {
  label: string
  amount: number
}

export function receiptText(
  businessName: string,
  order: Order,
  payments: readonly ReceiptPayment[],
  when: string,
): string {
  const rows = groupLines(order.lines)
    .filter((g) => g.activeQty > 0)
    .map((g) => `${g.activeQty} × ${g.nameSnap}: ${formatCop(g.activeQty * g.unitPrice)}`)
  const lines = [
    `*${businessName}*`,
    `${orderTitle(order)}, cuenta #${order.number}`,
    when,
    '',
    ...(rows.length > 0 ? rows : ['Sin consumo']),
    '',
    `*Total: ${formatCop(order.total)}*`,
  ]
  if (payments.length > 0) {
    lines.push(...payments.map((p) => `Pagado (${p.label}): ${formatCop(p.amount)}`))
    lines.push(
      order.balance > 0 ? `*Saldo pendiente: ${formatCop(order.balance)}*` : 'Cuenta pagada',
    )
  }
  lines.push('', '¡Gracias por tu visita!')
  return lines.join('\n')
}
