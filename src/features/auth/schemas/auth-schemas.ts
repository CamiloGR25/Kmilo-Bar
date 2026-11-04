import { z } from 'zod'

const email = z
  .string()
  .trim()
  .min(1, 'Escribe tu correo.')
  .pipe(z.email('El correo no tiene un formato válido.'))

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Escribe tu contraseña.'),
})

export const resetSchema = z.object({ email })

export type LoginValues = z.infer<typeof loginSchema>
export type ResetValues = z.infer<typeof resetSchema>
