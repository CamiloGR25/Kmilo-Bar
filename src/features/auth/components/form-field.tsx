import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'

/** Campo de formulario con etiqueta visible y error junto al campo. */
export function FormField({
  id,
  label,
  error,
  aside,
  children,
}: {
  id: string
  label: string
  error?: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={id}>{label}</Label>
        {aside}
      </div>
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-meta text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
