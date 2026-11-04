/**
 * Configuración pública de Firebase (no es secreta; la seguridad está en las Security Rules).
 * Los valores llegan por variables VITE_* (ver .env.example). Nunca poner aquí credenciales
 * administrativas ni cuentas de servicio (ARCHITECTURE §5).
 */
export interface FirebaseEnv {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
  useEmulators: boolean
}

const env = import.meta.env

export function readFirebaseEnv(): FirebaseEnv {
  const useEmulators = env.VITE_USE_EMULATORS === 'true'
  const projectId = env.VITE_FIREBASE_PROJECT_ID || (useEmulators ? 'demo-bar-kmilo' : '')

  const config: FirebaseEnv = {
    apiKey: env.VITE_FIREBASE_API_KEY || (useEmulators ? 'demo-api-key' : ''),
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
    projectId,
    appId: env.VITE_FIREBASE_APP_ID || (useEmulators ? 'demo-app-id' : ''),
    useEmulators,
  }

  const missing = (['apiKey', 'projectId', 'appId'] as const).filter((k) => !config[k])
  if (missing.length > 0) {
    throw new Error(
      `Faltan variables de Firebase: ${missing.join(', ')}. Copia .env.example a .env.local.`,
    )
  }
  return config
}
