/**
 * Gastos, gastos fijos, categorías y capital en Firestore (Fase 8, D-226).
 * R-FIN-03: un gasto o un movimiento de capital "de la caja" crea en el mismo commit su
 * movimiento de caja, que referencia al documento origen. Finanzas suma el origen; la caja,
 * el movimiento.
 */
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
  type Transaction,
} from 'firebase/firestore'
import { businessDateOf, formatBusinessDateLong, isBusinessDate } from '@/domain/dates'
import { formatCop } from '@/domain/money'
import { db } from '@/lib/firebase/firestore'
import { toDate, useSubscription } from '@/lib/firebase/use-subscription'
import { addAudit } from '@/features/audit/services/audit'
import { addDailyStats, dailyStatsUpdate } from '@/features/reports/services/daily-stats'
import {
  CAPITAL_LABELS,
  capitalStats,
  expenseStats,
  FinanceError,
  INITIAL_EXPENSE_CATEGORIES,
  periodOf,
  validateAmount,
  type CapitalEntry,
  type CapitalType,
  type Expense,
  type ExpenseCategory,
  type ExpenseKind,
  type FixedExpense,
  type PayMethod,
} from '../domain/finance'

export const newId = () => crypto.randomUUID()

const countersRef = () => doc(db, 'counters', 'cashSessions')

/** Caja abierta dentro de la transacción (para pagar o recibir "de la caja"). */
async function openSession(tx: Transaction) {
  const counters = await tx.get(countersRef())
  const sessionId = (counters.data()?.openSessionId as string | null) ?? null
  if (!sessionId) throw new FinanceError('Abre la caja para usar su efectivo.')
  const session = await tx.get(doc(db, 'cashSessions', sessionId))
  return { sessionId, businessDate: String(session.data()?.businessDate) }
}

// ---------------------------------------------------------------------------
// Categorías (D-226 #2)
// ---------------------------------------------------------------------------

export function useExpenseCategories() {
  return useSubscription<ExpenseCategory[]>(
    (onData, onError) =>
      onSnapshot(
        query(collection(db, 'expenseCategories'), orderBy('sortOrder')),
        (snap) =>
          onData(
            snap.docs.map((d) => ({
              id: d.id,
              name: String(d.data().name ?? ''),
              kind: (d.data().kind as ExpenseKind) ?? 'variable',
              active: d.data().active !== false,
              sortOrder: Number(d.data().sortOrder ?? 0),
            })),
          ),
        onError,
      ),
    'expenseCategories',
  )
}

/** Primera vez de la Fase 8: categorías iniciales. Idempotente. */
export async function ensureFinanceSetup(uid: string): Promise<boolean> {
  return runTransaction(db, async (tx) => {
    const first = doc(db, 'expenseCategories', INITIAL_EXPENSE_CATEGORIES[0]!.id)
    if ((await tx.get(first)).exists()) return false
    INITIAL_EXPENSE_CATEGORIES.forEach((c, i) =>
      tx.set(doc(db, 'expenseCategories', c.id), {
        name: c.name,
        kind: c.kind,
        active: true,
        sortOrder: i + 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    )
    addAudit(db, tx, uid, {
      action: 'inicializar',
      entity: 'finance',
      entityId: 'categorias',
      summary: `${INITIAL_EXPENSE_CATEGORIES.length} categorías de gasto iniciales creadas`,
    })
    return true
  })
}

export async function saveExpenseCategory(
  uid: string,
  category: ExpenseCategory | null,
  input: { name: string; kind: ExpenseKind },
  all: readonly ExpenseCategory[],
) {
  const name = input.name.trim()
  if (name.length < 2 || name.length > 60)
    throw new FinanceError('Escribe un nombre (2 a 60 letras).')
  if (all.some((c) => c.id !== category?.id && c.name.toLowerCase() === name.toLowerCase())) {
    throw new FinanceError('Ya existe una categoría con ese nombre.')
  }
  const batch = writeBatch(db)
  const ref = category
    ? doc(db, 'expenseCategories', category.id)
    : doc(collection(db, 'expenseCategories'))
  if (category) {
    batch.update(ref, { name, kind: input.kind, updatedAt: serverTimestamp() })
  } else {
    batch.set(ref, {
      name,
      kind: input.kind,
      active: true,
      sortOrder: Math.max(0, ...all.map((c) => c.sortOrder)) + 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  }
  addAudit(db, batch, uid, {
    action: category ? 'editar_categoria_gasto' : 'crear_categoria_gasto',
    entity: 'finance',
    entityId: ref.id,
    summary: `Categoría de gasto "${name}"`,
  })
  await batch.commit()
}

export async function setExpenseCategoryActive(uid: string, c: ExpenseCategory, active: boolean) {
  const batch = writeBatch(db)
  batch.update(doc(db, 'expenseCategories', c.id), { active, updatedAt: serverTimestamp() })
  addAudit(db, batch, uid, {
    action: active ? 'activar' : 'desactivar',
    entity: 'finance',
    entityId: c.id,
    summary: `Categoría de gasto "${c.name}" ${active ? 'activada' : 'desactivada'}`,
  })
  await batch.commit()
}

// ---------------------------------------------------------------------------
// Gastos fijos (D-226 #3)
// ---------------------------------------------------------------------------

export function useFixedExpenses() {
  return useSubscription<FixedExpense[]>(
    (onData, onError) =>
      onSnapshot(
        query(collection(db, 'fixedExpenses'), orderBy('name')),
        (snap) =>
          onData(
            snap.docs.map((d) => ({
              id: d.id,
              name: String(d.data().name ?? ''),
              categoryId: String(d.data().categoryId ?? ''),
              amount: Number(d.data().amount ?? 0),
              active: d.data().active !== false,
            })),
          ),
        onError,
      ),
    'fixedExpenses',
  )
}

export async function saveFixedExpense(
  uid: string,
  fixed: FixedExpense | null,
  input: { name: string; categoryId: string; amount: number | null },
) {
  const name = input.name.trim()
  if (name.length < 2 || name.length > 60)
    throw new FinanceError('Escribe el nombre del gasto fijo.')
  if (!input.categoryId) throw new FinanceError('Escoge la categoría.')
  const error = validateAmount(input.amount)
  if (error) throw new FinanceError(error)
  const batch = writeBatch(db)
  const ref = fixed ? doc(db, 'fixedExpenses', fixed.id) : doc(collection(db, 'fixedExpenses'))
  const data = {
    name,
    categoryId: input.categoryId,
    amount: input.amount!,
    updatedAt: serverTimestamp(),
  }
  if (fixed) batch.update(ref, data)
  else batch.set(ref, { ...data, active: true, createdAt: serverTimestamp() })
  addAudit(db, batch, uid, {
    action: fixed ? 'editar_gasto_fijo' : 'crear_gasto_fijo',
    entity: 'finance',
    entityId: ref.id,
    summary: `Gasto fijo "${name}": ${formatCop(input.amount!)} al mes`,
  })
  await batch.commit()
}

export async function setFixedExpenseActive(uid: string, f: FixedExpense, active: boolean) {
  const batch = writeBatch(db)
  batch.update(doc(db, 'fixedExpenses', f.id), { active, updatedAt: serverTimestamp() })
  addAudit(db, batch, uid, {
    action: active ? 'activar' : 'desactivar',
    entity: 'finance',
    entityId: f.id,
    summary: `Gasto fijo "${f.name}" ${active ? 'activado' : 'desactivado'}`,
  })
  await batch.commit()
}

// ---------------------------------------------------------------------------
// Gastos (F8-01)
// ---------------------------------------------------------------------------

export function expenseFromDoc(id: string, x: Record<string, unknown>): Expense {
  return {
    id,
    categoryId: String(x.categoryId ?? ''),
    categoryName: String(x.categoryName ?? ''),
    kind: (x.kind as ExpenseKind) ?? 'variable',
    amount: Number(x.amount ?? 0),
    businessDate: String(x.businessDate ?? ''),
    description: String(x.description ?? ''),
    method: (x.method as PayMethod) ?? 'efectivo',
    fromCash: x.fromCash === true,
    fixedExpenseId: (x.fixedExpenseId as string | null) ?? null,
    period: (x.period as string | null) ?? null,
    status: x.status === 'anulado' ? 'anulado' : 'activo',
    voidReason: (x.voidReason as string | null) ?? null,
    createdAt: toDate(x.createdAt),
  }
}

/** Gastos de un rango de jornadas (activos y anulados). */
export function useExpenses(from: string, to: string) {
  return useSubscription<Expense[]>(
    (onData, onError) =>
      onSnapshot(
        query(
          collection(db, 'expenses'),
          where('businessDate', '>=', from),
          where('businessDate', '<=', to),
          orderBy('businessDate', 'desc'),
        ),
        (snap) => onData(snap.docs.map((d) => expenseFromDoc(d.id, d.data()))),
        onError,
      ),
    `expenses/${from}/${to}`,
  )
}

export interface ExpenseInput {
  category: ExpenseCategory
  amount: number | null
  /** Jornada del gasto (si sale de la caja, la de la caja abierta). */
  businessDate: string
  description: string
  method: PayMethod
  fromCash: boolean
  fixedExpenseId: string | null
}

/** Registra un gasto; `expenseId` se genera antes (D-203). */
export async function registerExpense(uid: string, expenseId: string, input: ExpenseInput) {
  const error = validateAmount(input.amount)
  if (error) throw new FinanceError(error)
  if (!isBusinessDate(input.businessDate) || input.businessDate > businessDateOf(new Date())) {
    throw new FinanceError('La fecha no puede ser futura.')
  }
  if (input.description.trim().length > 200) throw new FinanceError('La descripción es muy larga.')
  if (input.fromCash && input.method !== 'efectivo')
    throw new FinanceError('De la caja solo sale efectivo.')
  const amount = input.amount!
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'expenses', expenseId)
    if ((await tx.get(ref)).exists()) return
    const cash = input.fromCash ? await openSession(tx) : null
    const businessDate = cash?.businessDate ?? input.businessDate
    tx.set(ref, {
      categoryId: input.category.id,
      categoryName: input.category.name,
      kind: input.category.kind,
      amount,
      businessDate,
      description: input.description.trim(),
      method: input.method,
      fromCash: input.fromCash,
      cashSessionId: cash?.sessionId ?? null,
      fixedExpenseId: input.fixedExpenseId,
      period: input.fixedExpenseId ? periodOf(businessDate) : null,
      status: 'activo',
      voidReason: null,
      voidedAt: null,
      uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    if (cash) {
      tx.set(doc(db, 'cashMovements', `ex-${expenseId}`), {
        sessionId: cash.sessionId,
        businessDate,
        type: 'gasto',
        amount: -amount,
        reason:
          `${input.category.name}${input.description.trim() ? `: ${input.description.trim()}` : ''}`.slice(
            0,
            200,
          ),
        refType: 'expense',
        refId: expenseId,
        uid,
        createdAt: serverTimestamp(),
      })
    }
    addDailyStats(db, tx, businessDate, expenseStats(input.category.kind, amount))
    addAudit(db, tx, uid, {
      action: 'registrar_gasto',
      entity: 'finance',
      entityId: expenseId,
      summary: `Gasto ${input.category.name}: ${formatCop(amount)}${cash ? ', de la caja' : ''}`,
    })
  })
}

/**
 * Anula un gasto (R-FIN-04): no se borra. Un gasto pagado de la caja solo se anula mientras esa
 * caja sigue abierta: el efectivo vuelve con una corrección. Si la caja ya se cerró, no se anula:
 * se corrige con una corrección o entrada extraordinaria en la caja actual (D-228).
 */
export async function voidExpense(uid: string, expense: Expense, reason: string) {
  if (reason.trim().length < 3) throw new FinanceError('Escribe el motivo.')
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'expenses', expense.id)
    const [snap, counters] = await Promise.all([tx.get(ref), tx.get(countersRef())])
    if (!snap.exists() || snap.data().status !== 'activo') return
    const sessionId = snap.data().cashSessionId as string | null
    // Las lecturas van antes de las escrituras en una transacción.
    const refund = Boolean(
      expense.fromCash && sessionId && counters.data()?.openSessionId === sessionId,
    )
    if (expense.fromCash && !refund) {
      throw new FinanceError(
        'Este gasto salió de una caja ya cerrada: no se anula. Regístralo como corrección o entrada extraordinaria en la caja actual.',
      )
    }
    const session = refund ? await tx.get(doc(db, 'cashSessions', sessionId!)) : null
    tx.update(ref, {
      status: 'anulado',
      voidReason: reason.trim(),
      voidedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    if (refund && session) {
      tx.set(doc(db, 'cashMovements', `exv-${expense.id}`), {
        sessionId,
        businessDate: String(session.data()?.businessDate),
        type: 'correccion',
        amount: expense.amount,
        reason: `Anulación del gasto ${expense.categoryName}`.slice(0, 200),
        refType: null,
        refId: null,
        uid,
        createdAt: serverTimestamp(),
      })
    }
    addDailyStats(db, tx, expense.businessDate, expenseStats(expense.kind, -expense.amount))
    addAudit(db, tx, uid, {
      action: 'anular_gasto',
      entity: 'finance',
      entityId: expense.id,
      summary: `Gasto ${expense.categoryName} de ${formatCop(expense.amount)} anulado`,
      reason: reason.trim(),
    })
  })
}

// ---------------------------------------------------------------------------
// Capital (F8-04)
// ---------------------------------------------------------------------------

export function capitalFromDoc(id: string, x: Record<string, unknown>): CapitalEntry {
  return {
    id,
    type: (x.type as CapitalType) ?? 'aporte',
    amount: Number(x.amount ?? 0),
    businessDate: String(x.businessDate ?? ''),
    description: String(x.description ?? ''),
    fromCash: x.fromCash === true,
    status: x.status === 'anulado' ? 'anulado' : 'activo',
    voidReason: (x.voidReason as string | null) ?? null,
    createdAt: toDate(x.createdAt),
  }
}

export function useCapitalEntries() {
  return useSubscription<CapitalEntry[]>(
    (onData, onError) =>
      onSnapshot(
        query(collection(db, 'capitalEntries'), orderBy('businessDate', 'desc')),
        (snap) => onData(snap.docs.map((d) => capitalFromDoc(d.id, d.data()))),
        onError,
      ),
    'capitalEntries',
  )
}

export interface CapitalInput {
  type: CapitalType
  amount: number | null
  businessDate: string
  description: string
  /** Aporte que entra a la caja o retiro que sale de ella. */
  fromCash: boolean
}

export async function registerCapital(uid: string, entryId: string, input: CapitalInput) {
  const error = validateAmount(input.amount)
  if (error) throw new FinanceError(error)
  if (!isBusinessDate(input.businessDate) || input.businessDate > businessDateOf(new Date())) {
    throw new FinanceError('La fecha no puede ser futura.')
  }
  const description = input.description.trim()
  if (input.type === 'inversion_inicial' && description.length < 2) {
    throw new FinanceError('Escribe en qué se invirtió (por ejemplo, "Nevera").')
  }
  if (description.length > 200) throw new FinanceError('La descripción es muy larga.')
  if (input.fromCash && input.type === 'inversion_inicial') {
    throw new FinanceError('La inversión inicial no sale de la caja.')
  }
  const amount = input.amount!
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'capitalEntries', entryId)
    if ((await tx.get(ref)).exists()) return
    const cash = input.fromCash ? await openSession(tx) : null
    const businessDate = cash?.businessDate ?? input.businessDate
    tx.set(ref, {
      type: input.type,
      amount,
      businessDate,
      description,
      fromCash: input.fromCash,
      cashSessionId: cash?.sessionId ?? null,
      status: 'activo',
      voidReason: null,
      voidedAt: null,
      uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    if (cash) {
      tx.set(doc(db, 'cashMovements', `cap-${entryId}`), {
        sessionId: cash.sessionId,
        businessDate,
        type: input.type === 'aporte' ? 'aporte' : 'retiro_dueno',
        amount: input.type === 'aporte' ? amount : -amount,
        reason: (description || CAPITAL_LABELS[input.type]).slice(0, 200),
        refType: 'capital',
        refId: entryId,
        uid,
        createdAt: serverTimestamp(),
      })
    }
    addDailyStats(db, tx, businessDate, capitalStats(input.type, amount))
    addAudit(db, tx, uid, {
      action: 'registrar_capital',
      entity: 'finance',
      entityId: entryId,
      summary: `${CAPITAL_LABELS[input.type]}: ${formatCop(amount)} (${formatBusinessDateLong(businessDate)})${cash ? ', en la caja' : ''}`,
    })
  })
}

/** Anula un movimiento de capital mal registrado (no se borra). La caja no se toca. */
export async function voidCapital(uid: string, entry: CapitalEntry, reason: string) {
  if (reason.trim().length < 3) throw new FinanceError('Escribe el motivo.')
  if (entry.fromCash) {
    throw new FinanceError(
      'Este movimiento pasó por la caja: corrígelo con una corrección de caja.',
    )
  }
  const batch = writeBatch(db)
  batch.update(doc(db, 'capitalEntries', entry.id), {
    status: 'anulado',
    voidReason: reason.trim(),
    voidedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  const delta = capitalStats(entry.type, -entry.amount)
  batch.set(
    doc(db, 'dailyStats', entry.businessDate),
    dailyStatsUpdate(entry.businessDate, delta),
    {
      merge: true,
    },
  )
  addAudit(db, batch, uid, {
    action: 'anular_capital',
    entity: 'finance',
    entityId: entry.id,
    summary: `${CAPITAL_LABELS[entry.type]} de ${formatCop(entry.amount)} anulado`,
    reason: reason.trim(),
  })
  await batch.commit()
}
