import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { routes } from '@/app/router'
import { AuthProvider } from '../auth-context'
import type { AuthService, AuthUser } from '../services/auth-service'

const ADMIN_UID = 'admin-uid'

// Las pantallas se cargan de forma diferida; se precargan para que la primera prueba no
// dependa del tiempo de transformación en frío del entorno de pruebas.
beforeAll(async () => {
  await import('@/features/dashboard/components/dashboard-preview')
}, 30_000)

/** Servicio de autenticación falso y controlable desde la prueba. */
function createFakeAuth(initial: AuthUser | null = null) {
  let listener: ((u: AuthUser | null) => void) | null = null
  const emit = (u: AuthUser | null) => act(() => listener?.(u))
  const service: AuthService = {
    subscribe(cb) {
      listener = cb
      queueMicrotask(() => cb(initial))
      return () => {
        listener = null
      }
    },
    signIn: vi.fn<AuthService['signIn']>(async () => {}),
    signOut: vi.fn<AuthService['signOut']>(async () => {
      listener?.(null)
    }),
    sendPasswordReset: vi.fn<AuthService['sendPasswordReset']>(async () => {}),
  }
  return { service, emit }
}

function renderApp(path: string, service: AuthService) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <AuthProvider service={service} adminUid={ADMIN_UID}>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
  return router
}

describe('rutas protegidas', () => {
  it('sin sesión, una ruta interna redirige a /login', async () => {
    const { service } = createFakeAuth(null)
    const router = renderApp('/inventario', service)
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('con la sesión del administrador muestra la app', async () => {
    const { service } = createFakeAuth({ uid: ADMIN_UID, email: 'admin@bar.co' })
    renderApp('/inventario', service)
    expect(await screen.findByRole('heading', { name: 'Inventario' })).toBeInTheDocument()
    expect(screen.getAllByText(/aún no está disponible/).length).toBeGreaterThan(0)
  })

  it('una cuenta que no es la del administrador se cierra y ve el aviso', async () => {
    const { service } = createFakeAuth({ uid: 'otro-uid', email: 'intruso@x.co' })
    renderApp('/', service)
    expect(
      await screen.findByText(/no tiene acceso al sistema/, undefined, { timeout: 5000 }),
    ).toBeInTheDocument()
    expect(service.signOut).toHaveBeenCalled()
  })
})

describe('inicio de sesión', () => {
  it('valida los campos antes de llamar a Firebase', async () => {
    const { service } = createFakeAuth(null)
    renderApp('/login', service)
    await userEvent.click(await screen.findByRole('button', { name: 'Ingresar' }))
    expect(await screen.findByText('Escribe tu correo.')).toBeInTheDocument()
    expect(screen.getByText('Escribe tu contraseña.')).toBeInTheDocument()
    expect(service.signIn).not.toHaveBeenCalled()
  })

  it('muestra un error claro si las credenciales fallan', async () => {
    const { service } = createFakeAuth(null)
    vi.mocked(service.signIn).mockRejectedValueOnce({ code: 'auth/invalid-credential' })
    renderApp('/login', service)
    await userEvent.type(await screen.findByLabelText('Correo'), 'admin@bar.co')
    await userEvent.type(screen.getByLabelText('Contraseña'), 'mala')
    await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }))
    expect(await screen.findByText('Correo o contraseña incorrectos.')).toBeInTheDocument()
  })

  it('al ingresar vuelve a la página que se pidió', async () => {
    const { service, emit } = createFakeAuth(null)
    const router = renderApp('/caja', service)
    await userEvent.type(await screen.findByLabelText('Correo'), 'admin@bar.co')
    await userEvent.type(screen.getByLabelText('Contraseña'), 'clave-correcta')
    await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }))
    expect(service.signIn).toHaveBeenCalledWith('admin@bar.co', 'clave-correcta')
    emit({ uid: ADMIN_UID, email: 'admin@bar.co' })
    await waitFor(() => expect(router.state.location.pathname).toBe('/caja'))
  })

  it('permite mostrar y ocultar la contraseña', async () => {
    const { service } = createFakeAuth(null)
    renderApp('/login', service)
    const input = await screen.findByLabelText('Contraseña')
    expect(input).toHaveAttribute('type', 'password')
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }))
    expect(input).toHaveAttribute('type', 'text')
  })
})

describe('restablecer contraseña', () => {
  it('muestra la misma confirmación aunque el correo no exista', async () => {
    const { service } = createFakeAuth(null)
    vi.mocked(service.sendPasswordReset).mockRejectedValueOnce({ code: 'auth/user-not-found' })
    renderApp('/recuperar', service)
    await userEvent.type(await screen.findByLabelText('Correo'), 'nadie@bar.co')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }))
    expect(await screen.findByRole('heading', { name: 'Revisa tu correo' })).toBeInTheDocument()
  })
})

describe('cerrar sesión', () => {
  it('desde la pantalla Más vuelve a /login', async () => {
    const { service } = createFakeAuth({ uid: ADMIN_UID, email: 'admin@bar.co' })
    const router = renderApp('/mas', service)
    // La barra lateral también tiene "Cerrar sesión" (oculta por CSS en el celular); se usa la de "Más".
    const buttons = await screen.findAllByRole('button', { name: 'Cerrar sesión' })
    await userEvent.click(buttons.at(-1)!)
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })
})
