/**
 * Acceso a Firebase Auth. El SDK se carga de forma diferida para que las pruebas
 * y la lógica de dominio no dependan de Firebase.
 */

export interface AuthUser {
  uid: string
  email: string | null
}

export interface AuthService {
  /** Se suscribe a los cambios de sesión. Devuelve la función para cancelar. */
  subscribe(callback: (user: AuthUser | null) => void): () => void
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  sendPasswordReset(email: string): Promise<void>
}

const firebase = () => import('@/lib/firebase')
const authSdk = () => import('firebase/auth')

export const firebaseAuthService: AuthService = {
  subscribe(callback) {
    let unsubscribe: (() => void) | undefined
    let cancelled = false
    void Promise.all([firebase(), authSdk()]).then(([{ auth }, { onAuthStateChanged }]) => {
      if (cancelled) return
      unsubscribe = onAuthStateChanged(auth, (user) =>
        callback(user ? { uid: user.uid, email: user.email } : null),
      )
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  },

  async signIn(email, password) {
    const [{ auth }, { signInWithEmailAndPassword }] = await Promise.all([firebase(), authSdk()])
    await signInWithEmailAndPassword(auth, email, password)
  },

  async signOut() {
    const [{ auth }, { signOut }] = await Promise.all([firebase(), authSdk()])
    await signOut(auth)
  },

  async sendPasswordReset(email) {
    const [{ auth }, { sendPasswordResetEmail }] = await Promise.all([firebase(), authSdk()])
    auth.languageCode = 'es'
    await sendPasswordResetEmail(auth, email)
  },
}
