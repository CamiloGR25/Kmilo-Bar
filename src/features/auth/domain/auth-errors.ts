/**
 * Traduce códigos de error de Firebase Auth a mensajes en español.
 * Los mensajes de credenciales son genéricos a propósito: no revelan si un correo existe.
 */

export type AuthAction = 'login' | 'reset'

const LOGIN_MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/invalid-login-credentials': 'Correo o contraseña incorrectos.',
  'auth/wrong-password': 'Correo o contraseña incorrectos.',
  'auth/user-not-found': 'Correo o contraseña incorrectos.',
  'auth/invalid-email': 'El correo no tiene un formato válido.',
  'auth/user-disabled': 'Esta cuenta está deshabilitada.',
  'auth/too-many-requests':
    'Demasiados intentos fallidos. Espera unos minutos o restablece tu contraseña.',
}

const COMMON_MESSAGES: Record<string, string> = {
  'auth/network-request-failed': 'No hay conexión a internet. Revisa la red e inténtalo de nuevo.',
  'auth/internal-error': 'Firebase no respondió. Inténtalo de nuevo en unos segundos.',
}

export function authErrorMessage(error: unknown, action: AuthAction): string {
  const code = getErrorCode(error)
  if (code && COMMON_MESSAGES[code]) return COMMON_MESSAGES[code]
  if (action === 'login' && code && LOGIN_MESSAGES[code]) return LOGIN_MESSAGES[code]
  if (action === 'reset' && code === 'auth/invalid-email')
    return 'El correo no tiene un formato válido.'
  if (action === 'reset' && code === 'auth/too-many-requests') {
    return 'Se enviaron demasiadas solicitudes. Espera unos minutos.'
  }
  return action === 'login'
    ? 'No se pudo iniciar sesión. Inténtalo de nuevo.'
    : 'No se pudo enviar el correo. Inténtalo de nuevo.'
}

function getErrorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code
    return typeof code === 'string' ? code : null
  }
  return null
}

/**
 * Al restablecer la contraseña se muestra la misma confirmación exista o no el correo,
 * para no revelar qué cuentas existen. Estos códigos se tratan como "enviado".
 */
export function isSilentResetError(error: unknown): boolean {
  return getErrorCode(error) === 'auth/user-not-found'
}
