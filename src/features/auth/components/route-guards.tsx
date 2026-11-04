import { Loader2 } from 'lucide-react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '../use-auth'

function FullScreenLoader() {
  return (
    <div role="status" className="grid min-h-dvh place-items-center text-muted-foreground">
      <span className="inline-flex items-center gap-3 text-label">
        <Loader2 aria-hidden className="size-5 animate-spin" />
        Verificando sesión…
      </span>
    </div>
  )
}

/** Solo deja pasar al administrador; si no, envía a /login recordando a dónde iba. */
export function RequireAdmin() {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <FullScreenLoader />
  if (status !== 'signed-in') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}

/** Pantallas públicas: si ya hay sesión de administrador, vuelve a donde iba. */
export function PublicOnly() {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <FullScreenLoader />
  if (status === 'signed-in') {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />
  }
  return <Outlet />
}
