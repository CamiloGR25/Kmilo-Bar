import { doc, onSnapshot, runTransaction, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '@/lib/firebase/firestore'
import { useSubscription } from '@/lib/firebase/use-subscription'
import { addAudit } from '@/features/audit/services/audit'
import { categoryIdFromName, INITIAL_CATEGORIES } from '@/features/products/domain/catalog'
import { diffSettings, settingsFromDoc, DEFAULT_SETTINGS, type Settings } from '../domain/settings'

const settingsRef = () => doc(db, 'settings', 'general')

/** Configuración en tiempo real. `exists` = false mientras no se haya inicializado. */
export function useSettings() {
  return useSubscription<{ settings: Settings; exists: boolean }>(
    (onData, onError) =>
      onSnapshot(
        settingsRef(),
        (snap) => onData({ settings: settingsFromDoc(snap.data()), exists: snap.exists() }),
        onError,
      ),
    'settings/general',
  )
}

/**
 * Primera ejecución: crea la configuración por defecto y las 12 categorías iniciales.
 * Es idempotente: si settings/general ya existe, no hace nada.
 */
export async function ensureInitialData(uid: string): Promise<boolean> {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(settingsRef())
    if (snap.exists()) return false
    tx.set(settingsRef(), { ...DEFAULT_SETTINGS, updatedAt: serverTimestamp() })
    for (const c of INITIAL_CATEGORIES) {
      tx.set(doc(db, 'categories', categoryIdFromName(c.name)), c)
    }
    tx.set(doc(db, 'auditLog', `init-${Date.now()}`), {
      action: 'inicializar',
      entity: 'catalog',
      entityId: 'general',
      summary: 'Configuración y categorías iniciales creadas',
      before: null,
      after: null,
      reason: null,
      uid,
      at: serverTimestamp(),
    })
    return true
  })
}

export async function saveSettings(uid: string, before: Settings, after: Settings) {
  const changed = diffSettings(before, after)
  if (changed.length === 0) return
  const batch = writeBatch(db)
  batch.set(settingsRef(), { ...after, updatedAt: serverTimestamp() })
  addAudit(db, batch, uid, {
    action: 'actualizar',
    entity: 'settings',
    entityId: 'general',
    summary: `Configuración: ${changed.join(', ')}`,
    before: Object.fromEntries(changed.map((k) => [k, before[k]])),
    after: Object.fromEntries(changed.map((k) => [k, after[k]])),
  })
  await batch.commit()
}
