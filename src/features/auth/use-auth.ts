import { createContext, useContext } from 'react'
import type { AuthService, AuthUser } from './services/auth-service'

/**
 * Estado de sesión.
 * - "unauthorized": hay sesión de Firebase, pero no es la del administrador. Se cierra la sesión.
 * La protección real son las Security Rules (isAdmin por UID); esto solo mejora la experiencia.
 */
export type AuthStatus = 'loading' | 'signed-out' | 'signed-in' | 'unauthorized'

export interface AuthState {
  status: AuthStatus
  user: AuthUser | null
}

export interface AuthContextValue extends AuthState {
  service: AuthService
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
