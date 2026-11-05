import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { ModulePending } from '@/components/shared/module-pending'
import { PageLoader } from '@/components/shared/page-loader'
import { LoginPage } from '@/features/auth/components/login-page'
import { ResetPasswordPage } from '@/features/auth/components/reset-password-page'
import { PublicOnly, RequireAdmin } from '@/features/auth/components/route-guards'
import { AppShell, MorePage } from './layouts/app-shell'
import { NAV_ITEMS } from './navigation'

/** Rutas ya construidas: cada pantalla se descarga solo cuando se visita. */
const BUILT = new Set(['/', '/productos', '/configuracion'])

/** Módulos aún no construidos: muestran en qué fase llegan. */
const pendingModules: RouteObject[] = NAV_ITEMS.filter((item) => !BUILT.has(item.to)).map(
  ({ to, label, phase, icon }) => ({
    path: to.slice(1),
    element: <ModulePending title={label} phase={phase} icon={icon} />,
  }),
)

export const routes: RouteObject[] = [
  {
    hydrateFallbackElement: <PageLoader />,
    children: [
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
              {
                index: true,
                lazy: async () => ({
                  Component: (await import('@/features/dashboard/components/dashboard-preview'))
                    .DashboardPreview,
                }),
              },
              { path: 'mas', element: <MorePage /> },
              {
                path: 'productos',
                lazy: async () => ({
                  Component: (await import('@/features/products/components/products-page'))
                    .ProductsPage,
                }),
              },
              {
                path: 'productos/nuevo',
                lazy: async () => ({
                  Component: (await import('@/features/products/components/product-form-page'))
                    .ProductFormPage,
                }),
              },
              {
                path: 'productos/importar',
                lazy: async () => ({
                  Component: (await import('@/features/products/components/import-page'))
                    .ImportPage,
                }),
              },
              {
                path: 'productos/:id',
                lazy: async () => ({
                  Component: (await import('@/features/products/components/product-form-page'))
                    .ProductFormPage,
                }),
              },
              {
                path: 'configuracion',
                lazy: async () => ({
                  Component: (await import('@/features/settings/components/settings-page'))
                    .SettingsPage,
                }),
              },
              ...pendingModules,
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]

export const createAppRouter = () => createBrowserRouter(routes)
