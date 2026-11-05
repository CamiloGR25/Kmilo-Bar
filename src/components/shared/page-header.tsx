import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'

/** Encabezado de página: título, descripción opcional, enlace de regreso y acciones. */
export function PageHeader({
  title,
  description,
  back,
  actions,
}: {
  title: string
  description?: ReactNode
  back?: { to: string; label: string }
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-4">
      {back && (
        <Link
          to={back.to}
          className="inline-flex w-fit items-center gap-2 text-label text-primary-text hover:underline"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-display font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1.5 text-label text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  )
}

/** Contenedor estándar de página dentro del AppShell. */
export function Page({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div
      className={`mx-auto flex w-full flex-col gap-8 px-4 pt-8 pb-16 sm:px-8 sm:pt-12 ${wide ? 'max-w-6xl' : 'max-w-4xl'}`}
    >
      {children}
    </div>
  )
}
