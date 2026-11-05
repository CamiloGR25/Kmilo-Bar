import { useState } from 'react'
import { Loader2, RefreshCcw } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { addBusinessDays, businessDateOf, daysBetween } from '@/domain/dates'
import { MAX_REBUILD_DAYS, validateRebuildRange } from '@/domain/metrics/daily-stats'
import { FormField } from '@/features/auth/components/form-field'
import { useAuth } from '@/features/auth/use-auth'
import { Section } from '@/features/settings/components/settings-page'
import { rebuildStats } from '../services/rebuild-stats'

/** Recálculo de estadísticas (F6-04): reconstruye días desde cuentas, pagos y movimientos. */
export function StatsRebuildSection() {
  const { user } = useAuth()
  const [today] = useState(() => businessDateOf(new Date()))
  const [from, setFrom] = useState(() => addBusinessDays(today, -6))
  const [to, setTo] = useState(today)
  const [confirm, setConfirm] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const error = validateRebuildRange(from, to, today)
  const total = error ? 0 : daysBetween(from, to) + 1

  return (
    <Section
      title="Recalcular estadísticas"
      description={`Si alguna cifra de Inicio o Ventas no cuadra, reconstrúyela desde las cuentas, los pagos y el inventario. Máximo ${MAX_REBUILD_DAYS} días por vez.`}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="rebuild-from" label="Desde">
          <Input
            id="rebuild-from"
            type="date"
            max={today}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </FormField>
        <FormField id="rebuild-to" label="Hasta">
          <Input
            id="rebuild-to"
            type="date"
            max={today}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </FormField>
      </div>
      {error ? (
        <p className="text-label text-destructive">{error}</p>
      ) : (
        <p className="text-label text-muted-foreground">
          {progress
            ? `Recalculando: ${progress.done} de ${progress.total} días…`
            : `Se recalcularán ${total} ${total === 1 ? 'día' : 'días'}.`}
        </p>
      )}
      <div>
        <Button
          variant="outline"
          disabled={Boolean(error) || progress !== null}
          onClick={() => setConfirm(true)}
        >
          {progress ? <Loader2 aria-hidden className="animate-spin" /> : <RefreshCcw aria-hidden />}
          Recalcular
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Recalcular estadísticas"
        confirmLabel="Recalcular"
        description={`Se reemplazarán las estadísticas de ${total} ${total === 1 ? 'día' : 'días'} con lo que dicen las cuentas, los pagos y los movimientos de inventario. Las cuentas y el inventario no cambian.`}
        onConfirm={async () => {
          setProgress({ done: 0, total })
          try {
            const n = await rebuildStats(user?.uid ?? '', from, to, (done, t) =>
              setProgress({ done, total: t }),
            )
            toast.success(`Estadísticas recalculadas: ${n} ${n === 1 ? 'día' : 'días'}`)
          } catch (e) {
            toast.error(`No se pudo recalcular: ${(e as Error).message}`)
          } finally {
            setProgress(null)
          }
        }}
      />
    </Section>
  )
}
