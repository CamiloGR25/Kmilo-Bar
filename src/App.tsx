import { useState } from 'react'
import { CalendarClock, CircleCheck, TriangleAlert, Wine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { businessDateOf, formatBusinessDate, formatTime } from '@/domain/dates'
import { applyBp, formatBp, formatCop, ratioToBp, roundUpToStep } from '@/domain/money'

/**
 * Pantalla provisional de la Fase 0: verifica tema, tipografía y dominio.
 * Se reemplaza por el router y el AppShell en la Fase 1.
 */
export default function App() {
  const [now] = useState(() => new Date())
  const cost = 3000
  const price = roundUpToStep(cost + applyBp(cost, 5000), 100)
  const margin = ratioToBp(price - cost, price) ?? 0

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-4 py-10">
      <header className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-xl bg-secondary text-primary-text">
          <Wine aria-hidden className="size-6" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold">Bar · Administración</h1>
          <p className="text-sm text-muted-foreground">Fase 0 · Fundaciones</p>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-3" aria-label="Indicadores de prueba">
        <Stat
          label="Precio sugerido"
          value={formatCop(price)}
          hint={`Costo ${formatCop(cost)} + 50 %`}
        />
        <Stat label="Margen bruto" value={formatBp(margin)} hint="Sobre el precio de venta" />
        <Stat
          label="Jornada actual"
          value={formatBusinessDate(businessDateOf(now))}
          hint={`Hora Bogotá ${formatTime(now)}`}
        />
      </section>

      <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <h2 className="font-medium">Estados</h2>
        <ul className="flex flex-wrap gap-4 text-sm">
          <li className="flex items-center gap-1.5 text-success">
            <CircleCheck aria-hidden className="size-4" /> Stock OK
          </li>
          <li className="flex items-center gap-1.5 text-warning">
            <TriangleAlert aria-hidden className="size-4" /> Cerca del mínimo
          </li>
          <li className="flex items-center gap-1.5 text-destructive">
            <TriangleAlert aria-hidden className="size-4" /> Agotado
          </li>
          <li className="flex items-center gap-1.5 text-primary-text">
            <CalendarClock aria-hidden className="size-4" /> Corte de jornada 06:00
          </li>
        </ul>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button>Acción principal</Button>
          <Button variant="secondary">Secundaria</Button>
          <Button variant="outline">Contorno</Button>
          <Button variant="destructive">Anular</Button>
        </div>
      </section>
    </main>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}
