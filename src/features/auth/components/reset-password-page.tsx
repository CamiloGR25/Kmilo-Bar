import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft, Loader2, MailCheck } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '../use-auth'
import { authErrorMessage, isSilentResetError } from '../domain/auth-errors'
import { resetSchema, type ResetValues } from '../schemas/auth-schemas'
import { AuthLayout } from './auth-layout'
import { FormField } from './form-field'

export function ResetPasswordPage() {
  const { service } = useAuth()
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetValues>({ resolver: zodResolver(resetSchema) })

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError(null)
    try {
      await service.sendPasswordReset(email)
      setSentTo(email)
    } catch (error) {
      if (isSilentResetError(error)) setSentTo(email)
      else setFormError(authErrorMessage(error, 'reset'))
    }
  })

  const back = (
    <Link
      to="/login"
      className="inline-flex items-center gap-2 text-label text-primary-text hover:underline"
    >
      <ArrowLeft aria-hidden className="size-4" />
      Volver a iniciar sesión
    </Link>
  )

  if (sentTo) {
    return (
      <AuthLayout title="Revisa tu correo" description="Te enviamos las instrucciones.">
        <div className="flex gap-3 rounded-lg border bg-card p-4">
          <MailCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
          <p className="text-label text-muted-foreground">
            Si <span className="font-medium text-foreground">{sentTo}</span> corresponde a una
            cuenta, recibirás un enlace para crear una contraseña nueva. Revisa también la carpeta
            de spam.
          </p>
        </div>
        <div className="mt-8">{back}</div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Restablecer contraseña"
      description="Escribe tu correo y te enviaremos un enlace para crear una contraseña nueva."
    >
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

        {formError && (
          <p role="alert" className="text-label text-destructive">
            {formError}
          </p>
        )}

        <Button type="submit" size="lg" disabled={isSubmitting} className="w-full">
          {isSubmitting && <Loader2 aria-hidden className="animate-spin" />}
          {isSubmitting ? 'Enviando…' : 'Enviar enlace'}
        </Button>
      </form>
      <div className="mt-8">{back}</div>
    </AuthLayout>
  )
}
