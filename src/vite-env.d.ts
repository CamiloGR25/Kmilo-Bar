/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_EMULATORS?: 'true' | 'false'
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
  /** UID del administrador (mismo valor que en firestore.rules). */
  readonly VITE_ADMIN_UID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
