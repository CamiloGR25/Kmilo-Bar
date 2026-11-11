/* oxlint-disable no-console -- scripts de línea de comandos */
/**
 * Respaldo JSON y restauración (Fase 10). Dos comandos:
 *   npx tsx scripts/report-mail/backup.ts backup <archivo.json>
 *   npx tsx scripts/report-mail/backup.ts restore <archivo.json>   (solo emulador)
 * El respaldo contiene todas las ventas del bar: no lo subas a un repositorio público ni lo
 * compartas por medios no seguros. Las marcas de tiempo se guardan como { "$ts": ISO }.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import { adminDb } from './admin-data'

/** Todas las colecciones de la app (DATA_MODEL). */
export const BACKUP_COLLECTIONS = [
  'settings',
  'categories',
  'products',
  'priceHistory',
  'inventoryMovements',
  'counters',
  'tables',
  'orders',
  'payments',
  'cashSessions',
  'cashMovements',
  'suppliers',
  'purchaseOrders',
  'receptions',
  'supplierPayments',
  'expenseCategories',
  'fixedExpenses',
  'expenses',
  'capitalEntries',
  'dailyStats',
  'auditLog',
] as const

type Dump = Record<string, Record<string, Record<string, unknown>>>

function encode(v: unknown): unknown {
  if (v instanceof Timestamp) return { $ts: v.toDate().toISOString() }
  if (Array.isArray(v)) return v.map(encode)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]))
  }
  return v
}

function decode(v: unknown): unknown {
  if (v && typeof v === 'object' && '$ts' in v && Object.keys(v).length === 1) {
    return Timestamp.fromDate(new Date((v as { $ts: string }).$ts))
  }
  if (Array.isArray(v)) return v.map(decode)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]))
  }
  return v
}

export async function dumpAll(db: Firestore): Promise<Dump> {
  const out: Dump = {}
  for (const name of BACKUP_COLLECTIONS) {
    const snap = await db.collection(name).get()
    out[name] = Object.fromEntries(
      snap.docs.map((d) => [d.id, encode(d.data()) as Record<string, unknown>]),
    )
  }
  return out
}

/** Escribe los documentos del respaldo (sin borrar lo que ya exista). */
export async function restoreAll(db: Firestore, dump: Dump): Promise<number> {
  let written = 0
  for (const name of BACKUP_COLLECTIONS) {
    const docs = dump[name] ?? {}
    for (const [id, data] of Object.entries(docs)) {
      await db
        .collection(name)
        .doc(id)
        .set(decode(data) as Record<string, unknown>)
      written++
    }
  }
  return written
}

async function main() {
  const [cmd, file] = process.argv.slice(2)
  if (!file || (cmd !== 'backup' && cmd !== 'restore')) {
    throw new Error('Uso: backup.ts backup|restore <archivo.json>')
  }
  const db = adminDb()
  if (cmd === 'backup') {
    const dump = await dumpAll(db)
    writeFileSync(file, JSON.stringify(dump), 'utf8')
    const total = Object.values(dump).reduce((n, c) => n + Object.keys(c).length, 0)
    console.log(`Respaldo guardado: ${total} documentos.`)
    return
  }
  // Restaurar solo en el emulador: restaurar sobre la base real es una decisión aparte.
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'La restauración solo está permitida contra el emulador (FIRESTORE_EMULATOR_HOST).',
    )
  }
  const dump = JSON.parse(readFileSync(file, 'utf8')) as Dump
  const written = await restoreAll(db, dump)
  console.log(`Restaurados ${written} documentos en el emulador.`)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'Error desconocido')
  process.exit(1)
})
