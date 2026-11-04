import type { LucideIcon } from 'lucide-react'

/** Estado vacío de un módulo que aún no se construye (indica en qué fase llega). */
export function ModulePending({
  title,
  phase,
  icon: Icon,
}: {
  title: string
  phase: number
  icon: LucideIcon
}) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 pt-8 sm:px-8 sm:pt-12">
      <h1 className="text-display font-semibold tracking-tight">{title}</h1>
      <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed bg-card p-6 sm:p-8">
        <Icon aria-hidden className="size-8 text-subtle-foreground" />
        <p className="text-title font-semibold">Este módulo aún no está disponible</p>
        <p className="max-w-prose text-label text-muted-foreground">
          Se construye en la fase {phase} del plan de desarrollo.
        </p>
      </div>
    </div>
  )
}
