import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { firebaseAuthService, type AuthService } from './services/auth-service'
import { AuthContext, type AuthState } from './use-auth'

export function AuthProvider({
  children,
  service = firebaseAuthService,
  adminUid = import.meta.env.VITE_ADMIN_UID,
}: {
  children: ReactNode
  service?: AuthService
  /** UID autorizado (el mismo de firestore.rules). Sin él, cualquier sesión se trata como no autorizada. */
  adminUid?: string
}) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null })

  useEffect(() => {
    return service.subscribe((user) => {
      if (!user) {
        setState((prev) =>
          // Mantener "unauthorized" tras cerrar la sesión ajena, para mostrar el aviso.
          prev.status === 'unauthorized' ? prev : { status: 'signed-out', user: null },
        )
        return
      }
      if (!adminUid || user.uid !== adminUid) {
        setState({ status: 'unauthorized', user })
        void service.signOut()
        return
      }
      setState({ status: 'signed-in', user })
    })
  }, [service, adminUid])

  const value = useMemo(() => ({ ...state, service }), [state, service])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
