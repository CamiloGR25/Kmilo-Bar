import type { ReactNode } from 'react'
import { Motorbike } from 'lucide-react'
import { BrandMark, BUSINESS_NAME } from '@/components/shared/brand'
import { cn } from '@/lib/utils'

/** Línea de carretera discontinua: el tramo azul es el "recorrido" de la jornada. */
function RoadLine({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('flex items-center gap-3', className)}>
      {[16, 6, 6, 6, 6, 6].map((w, i) => (
        <span
          key={i}
          style={{ width: `${w * 0.25}rem` }}
          className={cn('h-1 rounded-full', i === 0 ? 'bg-primary' : 'bg-border-strong')}
        />
      ))}
    </div>
  )
}

/** Marco de las pantallas públicas (iniciar sesión, restablecer contraseña). */
export function AuthLayout({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(28rem,34rem)]">
      <BrandPanel />

      <main className="flex flex-col justify-center px-4 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="flex flex-col gap-5 lg:hidden">
            <BrandMark size="lg" />
            <p className="text-[3.25rem] leading-[0.9] font-semibold tracking-[-0.04em]">
              {BUSINESS_NAME}
            </p>
            <RoadLine />
          </div>
          <h1 className="mt-12 text-figure font-semibold tracking-tight lg:mt-0">{title}</h1>
          <p className="mt-2 text-label text-muted-foreground">{description}</p>
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  )
}

/**
 * Panel de marca (solo computador): el nombre es el protagonista; detrás, la moto en línea
 * fina iluminada por un halo azul, como el farol en la noche, y una línea de carretera abajo.
 */
function BrandPanel() {
  return (
    <aside className="relative isolate hidden overflow-hidden border-r bg-card lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
      {/* Halo del farol */}
      <div
        aria-hidden
        className="absolute top-[-12rem] right-[-16rem] -z-10 size-[44rem] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--primary)_18%,transparent),transparent)]"
      />
      {/* Moto en línea fina (trazo constante, no crece con el tamaño) */}
      <Motorbike
        aria-hidden
        strokeWidth={1.75}
        className="absolute top-10 right-6 -z-10 size-[24rem] text-primary-text/60 xl:top-8 xl:right-10 xl:size-[30rem] [&_*]:[vector-effect:non-scaling-stroke]"
      />

      <BrandMark size="lg" />

      <div>
        <p className="text-[clamp(4.5rem,8.5vw,8rem)] leading-[0.88] font-semibold tracking-[-0.045em]">
          Kmilo
          <br />
          Bar
        </p>
        <p className="mt-8 max-w-sm text-lg leading-relaxed text-muted-foreground">
          Mesas, caja e inventario de cada jornada, en un solo lugar.
        </p>
        <RoadLine className="mt-10" />
      </div>

      <p className="text-meta text-subtle-foreground">Acceso exclusivo para el administrador.</p>
    </aside>
  )
}
