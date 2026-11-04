import { useState } from 'react'
import { LogOut, Menu } from 'lucide-react'
import { NavLink, Outlet } from 'react-router'
import { toast } from 'sonner'
import { BrandLockup } from '@/components/shared/brand'
import { useAuth } from '@/features/auth/use-auth'
import { cn } from '@/lib/utils'
import { NAV_ITEMS } from '../navigation'

/**
 * Estructura de la app autenticada (DESIGN_SYSTEM §6):
 * barra lateral en escritorio (≥ 1024 px) y barra inferior en el celular.
 */
export function AppShell() {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <Sidebar />
      <main className="min-w-0 pb-24 lg:pb-0">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}

function useSignOut() {
  const { service } = useAuth()
  const [pending, setPending] = useState(false)
  return {
    pending,
    signOut: async () => {
      setPending(true)
      try {
        await service.signOut()
      } catch {
        toast.error('No se pudo cerrar la sesión. Inténtalo de nuevo.')
        setPending(false)
      }
    },
  }
}

function Sidebar() {
  const { user } = useAuth()
  const { signOut, pending } = useSignOut()
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col border-r bg-card lg:flex">
      <div className="px-5 pt-6 pb-5">
        <BrandLockup />
      </div>
      <nav aria-label="Principal" className="flex-1 overflow-y-auto px-3">
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex h-10 items-center gap-3 rounded-lg px-3 text-label font-medium transition-colors',
                    isActive
                      ? 'bg-raised text-foreground'
                      : 'text-muted-foreground hover:bg-raised/60 hover:text-foreground',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      aria-hidden
                      className={cn('size-[1.125rem]', isActive && 'text-primary-text')}
                    />
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="border-t p-3">
        <p className="truncate px-3 pb-2 text-meta text-subtle-foreground">{user?.email}</p>
        <button
          type="button"
          onClick={signOut}
          disabled={pending}
          className="flex h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-label font-medium text-muted-foreground transition-colors hover:bg-raised/60 hover:text-foreground disabled:opacity-50"
        >
          <LogOut aria-hidden className="size-[1.125rem]" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  )
}

function BottomNav() {
  const items = NAV_ITEMS.filter((i) => i.mobile)
  const linkClass = (isActive: boolean) =>
    cn(
      'flex h-full flex-col items-center justify-center gap-1 text-[0.75rem] font-medium leading-none transition-colors',
      isActive ? 'text-primary-text' : 'text-muted-foreground hover:text-foreground',
    )
  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="grid h-16 grid-cols-5">
        {items.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink to={to} className={({ isActive }) => linkClass(isActive)}>
              <Icon aria-hidden className="size-[1.375rem]" />
              {label === 'Venta en barra' ? 'Barra' : label}
            </NavLink>
          </li>
        ))}
        <li>
          <NavLink to="/mas" className={({ isActive }) => linkClass(isActive)}>
            <Menu aria-hidden className="size-[1.375rem]" />
            Más
          </NavLink>
        </li>
      </ul>
    </nav>
  )
}

/** Pantalla "Más" del celular: todos los módulos y cerrar sesión. */
export function MorePage() {
  const { user } = useAuth()
  const { signOut, pending } = useSignOut()
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 pt-8">
      <h1 className="text-figure font-semibold tracking-tight">Más</h1>
      <ul className="divide-y divide-border rounded-xl border bg-card">
        {NAV_ITEMS.filter((i) => !i.mobile).map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === '/'}
              className="flex h-14 items-center gap-3 px-4 font-medium transition-colors hover:bg-raised"
            >
              <Icon aria-hidden className="size-5 text-muted-foreground" />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <p className="text-label text-muted-foreground">
          Sesión iniciada como <span className="text-foreground">{user?.email}</span>
        </p>
        <button
          type="button"
          onClick={signOut}
          disabled={pending}
          className="flex h-11 cursor-pointer items-center gap-3 rounded-lg px-1 font-medium text-destructive hover:bg-destructive-solid/10 disabled:opacity-50"
        >
          <LogOut aria-hidden className="size-5" />
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}
