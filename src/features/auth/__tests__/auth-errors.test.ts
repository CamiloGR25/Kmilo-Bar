import { describe, expect, it } from 'vitest'
import { authErrorMessage, isSilentResetError } from '../domain/auth-errors'
import { loginSchema, resetSchema } from '../schemas/auth-schemas'

const err = (code: string) => ({ code })

describe('authErrorMessage', () => {
  it('no revela si el correo existe: credenciales siempre con el mismo mensaje', () => {
    const msg = 'Correo o contraseña incorrectos.'
    expect(authErrorMessage(err('auth/invalid-credential'), 'login')).toBe(msg)
    expect(authErrorMessage(err('auth/user-not-found'), 'login')).toBe(msg)
    expect(authErrorMessage(err('auth/wrong-password'), 'login')).toBe(msg)
  })
  it('explica el bloqueo por intentos y la falta de conexión', () => {
    expect(authErrorMessage(err('auth/too-many-requests'), 'login')).toMatch(/Demasiados intentos/)
    expect(authErrorMessage(err('auth/network-request-failed'), 'reset')).toMatch(/conexión/)
  })
  it('tiene un mensaje genérico para errores desconocidos', () => {
    expect(authErrorMessage(new Error('x'), 'login')).toBe(
      'No se pudo iniciar sesión. Inténtalo de nuevo.',
    )
    expect(authErrorMessage(null, 'reset')).toBe('No se pudo enviar el correo. Inténtalo de nuevo.')
  })
  it('al restablecer, "usuario no encontrado" se trata como enviado', () => {
    expect(isSilentResetError(err('auth/user-not-found'))).toBe(true)
    expect(isSilentResetError(err('auth/network-request-failed'))).toBe(false)
  })
})

describe('esquemas', () => {
  it('valida correo y contraseña obligatorios', () => {
    expect(loginSchema.safeParse({ email: '', password: '' }).success).toBe(false)
    expect(loginSchema.safeParse({ email: 'no-es-correo', password: 'x' }).success).toBe(false)
    expect(loginSchema.safeParse({ email: ' admin@bar.co ', password: 'x' })).toMatchObject({
      success: true,
      data: { email: 'admin@bar.co' },
    })
    expect(resetSchema.safeParse({ email: 'admin@bar.co' }).success).toBe(true)
  })
})
