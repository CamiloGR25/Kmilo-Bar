/**
 * Lectura de datos con el SDK de administración para los scripts del servidor (Fase 10).
 * Solo lo usa el envío programado y el respaldo: nunca el navegador.
 */
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore, type Query } from 'firebase-admin/firestore'
import {
  buildReportInput,
  type RawDoc,
  type RawDocs,
} from '../../src/features/reports/domain/report-input'
import type { BusinessDateRange } from '../../src/domain/dates'
import type { ReportInput } from '../../src/features/reports/domain/reports'

/**
 * Credenciales: `FIREBASE_SERVICE_ACCOUNT` (JSON de la cuenta de servicio, como secreto de
 * GitHub). Con el emulador (`FIRESTORE_EMULATOR_HOST`) no hace falta ninguna.
 */
export function adminDb(): Firestore {
  if (getApps().length === 0) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT
    const emulator = process.env.FIRESTORE_EMULATOR_HOST
    if (!raw && !emulator) {
      throw new Error('Falta FIREBASE_SERVICE_ACCOUNT (o FIRESTORE_EMULATOR_HOST para pruebas).')
    }
    const app: App = raw
      ? initializeApp({ credential: cert(JSON.parse(raw)) })
      : initializeApp({ projectId: 'demo-bar-kmilo' })
    return getFirestore(app)
  }
  return getFirestore()
}

async function readAll(db: Firestore, name: string, q?: Query): Promise<RawDoc[]> {
  const snap = await (q ?? db.collection(name)).get()
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }))
}

function inRange(db: Firestore, name: string, r: BusinessDateRange): Query {
  return db.collection(name).where('businessDate', '>=', r.from).where('businessDate', '<=', r.to)
}

/** Lee del emulador o de Firestore lo que necesitan los reportes del periodo. */
export async function loadInputAdmin(
  db: Firestore,
  range: BusinessDateRange,
): Promise<ReportInput> {
  const raw: RawDocs = {
    dailyStats: await readAll(db, 'dailyStats', inRange(db, 'dailyStats', range)),
    products: await readAll(db, 'products'),
    categories: await readAll(db, 'categories'),
    inventoryMovements: await readAll(
      db,
      'inventoryMovements',
      inRange(db, 'inventoryMovements', range),
    ),
    expenses: await readAll(db, 'expenses', inRange(db, 'expenses', range)),
    receptions: await readAll(db, 'receptions', inRange(db, 'receptions', range)),
    supplierPayments: await readAll(db, 'supplierPayments', inRange(db, 'supplierPayments', range)),
    suppliers: await readAll(db, 'suppliers'),
    cashSessions: await readAll(db, 'cashSessions', inRange(db, 'cashSessions', range)),
  }
  return buildReportInput(range, raw)
}
