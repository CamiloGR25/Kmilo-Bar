/** Instancia única de Firestore con caché persistente (consulta sin conexión). */
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'
import { app, env } from './index'

export const db: Firestore = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

if (env.useEmulators) {
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
