/**
 * Inicialización única de Firebase. Se importa de forma diferida desde los servicios,
 * así las pruebas de dominio no cargan el SDK.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'
import { readFirebaseEnv } from './config'

const env = readFirebaseEnv()

export const app: FirebaseApp = initializeApp({
  apiKey: env.apiKey,
  authDomain: env.authDomain,
  projectId: env.projectId,
  appId: env.appId,
})

export const auth: Auth = getAuth(app)

/** Caché persistente: permite consultar sin conexión (las escrituras de negocio exigen red). */
export const db: Firestore = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

if (env.useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
