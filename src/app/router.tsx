import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { ModulePending } from '@/components/shared/module-pending'
import { PageLoader } from '@/components/shared/page-loader'
import { LoginPage } from '@/features/auth/components/login-page'
import { ResetPasswordPage } from '@/features/auth/components/reset-password-page'
import { PublicOnly, RequireAdmin } from '@/features/auth/components/route-guards'
import { AppShell, MorePage } from './layouts/app-shell'
import { NAV_ITEMS } from './navigation'

/** Rutas ya construidas: cada pantalla se descarga solo cuando se visita. */
const BUILT = new Set([
  '/',
  '/mesas',
  '/barra',
  '/cuentas',
  '/caja',
  '/ventas',
  '/compras',
  '/proveedores',
  '/gastos',
  '/finanzas',
  '/productos',
  '/inventario',
  '/configuracion',
])

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
                  Component: (await import('@/features/dashboard/components/dashboard-page'))
                    .DashboardPage,
                }),
              },
              { path: 'mas', element: <MorePage /> },
              {
                path: 'mesas',
                lazy: async () => ({
                  Component: (await import('@/features/tables/components/tables-page')).TablesPage,
                }),
              },
              {
                path: 'barra',
                lazy: async () => ({
                  Component: (await import('@/features/orders/components/bar-page')).BarPage,
                }),
              },
              {
                path: 'cuentas',
                lazy: async () => ({
                  Component: (await import('@/features/orders/components/orders-history-page'))
                    .OrdersHistoryPage,
                }),
              },
              {
                path: 'cuentas/:id',
                lazy: async () => ({
                  Component: (await import('@/features/orders/components/order-page')).OrderPage,
                }),
              },
              {
                path: 'caja',
                lazy: async () => ({
                  Component: (await import('@/features/cash/components/cash-page')).CashPage,
                }),
              },
              {
                path: 'proveedores',
                lazy: async () => ({
                  Component: (await import('@/features/purchases/components/suppliers-page'))
                    .SuppliersPage,
                }),
              },
              {
                path: 'proveedores/:id',
                lazy: async () => ({
                  Component: (await import('@/features/purchases/components/supplier-page'))
                    .SupplierPage,
                }),
              },
              {
                path: 'compras',
                lazy: async () => ({
                  Component: (await import('@/features/purchases/components/purchases-page'))
                    .PurchasesPage,
                }),
              },
              {
                path: 'compras/nuevo',
                lazy: async () => ({
                  Component: (await import('@/features/purchases/components/purchase-form-page'))
                    .PurchaseFormPage,
                }),
              },
              {
                path: 'compras/:id',
                lazy: async () => ({
                  Component: (await import('@/features/purchases/components/purchase-page'))
                    .PurchasePage,
                }),
              },
              {
                path: 'compras/:id/editar',
                lazy: async () => ({
                  Component: (await import('@/features/purchases/components/purchase-form-page'))
                    .PurchaseFormPage,
                }),
              },
              {
                path: 'gastos',
                lazy: async () => ({
                  Component: (await import('@/features/finance/components/expenses-page'))
                    .ExpensesPage,
                }),
              },
              {
                path: 'finanzas',
                lazy: async () => ({
                  Component: (await import('@/features/finance/components/finance-page'))
                    .FinancePage,
                }),
              },
              {
                path: 'finanzas/capital',
                lazy: async () => ({
                  Component: (await import('@/features/finance/components/capital-page'))
                    .CapitalPage,
                }),
              },
              {
                path: 'ventas',
                lazy: async () => ({
                  Component: (await import('@/features/reports/components/sales-page')).SalesPage,
                }),
              },
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
                path: 'inventario',
                lazy: async () => ({
                  Component: (await import('@/features/inventory/components/inventory-page'))
                    .InventoryPage,
                }),
              },
              {
                path: 'inventario/recomendaciones',
                lazy: async () => ({
                  Component: (await import('@/features/inventory/components/recommendations-page'))
                    .RecommendationsPage,
                }),
              },
              {
                path: 'inventario/conteo',
                lazy: async () => ({
                  Component: (await import('@/features/inventory/components/count-page')).CountPage,
                }),
              },
              {
                path: 'inventario/:id',
                lazy: async () => ({
                  Component: (await import('@/features/inventory/components/kardex-page'))
                    .KardexPage,
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
