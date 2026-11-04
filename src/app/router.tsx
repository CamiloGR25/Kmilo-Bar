import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { ModulePending } from '@/components/shared/module-pending'
import { LoginPage } from '@/features/auth/components/login-page'
import { ResetPasswordPage } from '@/features/auth/components/reset-password-page'
import { PublicOnly, RequireAdmin } from '@/features/auth/components/route-guards'
import { DashboardPreview } from '@/features/dashboard/components/dashboard-preview'
import { AppShell, MorePage } from './layouts/app-shell'
import { NAV_ITEMS } from './navigation'

/** Módulos aún no construidos: muestran en qué fase llegan. */
const pendingModules: RouteObject[] = NAV_ITEMS.filter((item) => item.to !== '/').map(
  ({ to, label, phase, icon }) => ({
    path: to.slice(1),
    element: <ModulePending title={label} phase={phase} icon={icon} />,
  }),
)

export const routes: RouteObject[] = [
  {
    element: <PublicOnly />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/recuperar', element: <ResetPasswordPage /> },
    ],
  },
  {
    element: <RequireAdmin />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <DashboardPreview /> },
          { path: 'mas', element: <MorePage /> },
          ...pendingModules,
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]

export const createAppRouter = () => createBrowserRouter(routes)
