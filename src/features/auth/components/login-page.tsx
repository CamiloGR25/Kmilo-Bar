import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff, Loader2, ShieldAlert } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '../use-auth'
import { authErrorMessage } from '../domain/auth-errors'
import { loginSchema, type LoginValues } from '../schemas/auth-schemas'
import { AuthLayout } from './auth-layout'
import { FormField } from './form-field'

export function LoginPage() {
  const { service, status } = useAuth()
  const [formError, setFormError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) })

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setFormError(null)
    try {
      await service.signIn(email, password)
      // La redirección la hace la ruta pública al cambiar el estado de sesión.
    } catch (error) {
      setFormError(authErrorMessage(error, 'login'))
    }
  })

  return (
    <AuthLayout title="Iniciar sesión" description="Ingresa con tu correo de administrador.">
      {status === 'unauthorized' && !formError && (
        <div
          role="alert"
          className="mb-6 flex gap-3 rounded-lg border border-current/30 bg-destructive-solid/10 p-3.5 text-destructive"
        >
          <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          <p className="text-label">
            Esa cuenta no tiene acceso al sistema. Ingresa con el correo del administrador.
          </p>
        </div>
      )}

      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
        <FormField id="email" label="Correo" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'email-error' : undefined}
            {...register('email')}
          />
        </FormField>

        <FormField
          id="password"
          label="Contraseña"
          error={errors.password?.message}
          aside={
            <Link to="/recuperar" className="text-label text-primary-text hover:underline">
              ¿La olvidaste?
            </Link>
          }
        >
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              className="pr-12"
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'password-error' : undefined}
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 grid w-11 cursor-pointer place-items-center rounded-r-lg text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          </div>
        </FormField>

        {formError && (
          <p role="alert" className="text-label text-destructive">
            {formError}
          </p>
        )}

        <Button type="submit" size="lg" disabled={isSubmitting} className="mt-1 w-full">
          {isSubmitting && <Loader2 aria-hidden className="animate-spin" />}
          {isSubmitting ? 'Ingresando…' : 'Ingresar'}
        </Button>
      </form>
    </AuthLayout>
  )
}
