/**
 * App y Auth de Firebase. Firestore vive en ./firestore.ts para no cargarlo en el
 * inicio de sesión (se importa solo cuando una pantalla lo necesita).
 */
import { initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import { readFirebaseEnv } from './config'

export const env = readFirebaseEnv()

export const app: FirebaseApp = initializeApp({
  apiKey: env.apiKey,
  authDomain: env.authDomain,
  projectId: env.projectId,
  appId: env.appId,
})

export const auth: Auth = getAuth(app)

if (env.useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
}
