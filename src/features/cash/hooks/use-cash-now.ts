import { expectedCash, sessionTotals } from '../domain/payments'
import { useCashMovements, useOpenCashSession } from '../services/cash-service'
import { usePaymentsOfSession } from '../services/payments-service'

/** Caja abierta y el efectivo que debería haber en este momento (para validar salidas). */
export function useCashNow() {
  const session = useOpenCashSession().data ?? null
  const payments = usePaymentsOfSession(session?.id)
  const moves = useCashMovements(session?.id)
  const cashNow = session
    ? expectedCash(session.openingBalance, sessionTotals(payments.data ?? [], moves.data ?? []))
    : 0
  return { session, cashNow }
}
