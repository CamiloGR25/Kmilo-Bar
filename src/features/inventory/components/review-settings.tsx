import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { IntegerInput } from '@/components/shared/inputs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { businessDateOf, formatBusinessDateLong } from '@/domain/dates'
import { FormField } from '@/features/auth/components/form-field'
import { useAuth } from '@/features/auth/use-auth'
import { Section } from '@/features/settings/components/settings-page'
import { reviewDueDate, type InventoryReviewState } from '../domain/review'
import { saveReviewSettings, useInventoryReview } from '../services/review-service'

/** Configuración de la revisión de inventario periódica (R-INV-11). */
export function ReviewSettingsSection() {
  const review = useInventoryReview()
  return (
    <Section
      title="Revisión de inventario"
      description="Cada cuánto se cuenta todo el inventario y cuándo fue la última vez."
    >
      {review.data ? (
        <ReviewSettingsForm key={JSON.stringify(review.data)} state={review.data} />
      ) : (
        <p className="inline-flex items-center gap-2 text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Cargando…
        </p>
      )}
    </Section>
  )
}

function ReviewSettingsForm({ state }: { state: InventoryReviewState }) {
  const { user } = useAuth()
  const [today] = useState(() => businessDateOf(new Date()))
  const [months, setMonths] = useState<number | null>(state.periodMonths)
  const [last, setLast] = useState(state.lastReviewDate)
  const [pending, setPending] = useState(false)

  const monthsError =
    months === null || months < 1 || months > 12 ? 'Escribe entre 1 y 12 meses.' : undefined
  const lastError = !last || last > today ? 'No puede ser una fecha futura.' : undefined
  const dirty = months !== state.periodMonths || last !== state.lastReviewDate
  const due =
    !monthsError && !lastError
      ? reviewDueDate({ periodMonths: months!, lastReviewDate: last })
      : null

  async function save() {
    setPending(true)
    try {
      await saveReviewSettings(user?.uid ?? '', months!, last)
      toast.success('Revisión de inventario actualizada')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="review-months" label="Cada cuántos meses" error={monthsError}>
          <IntegerInput
            id="review-months"
            value={months}
            onChange={setMonths}
            suffix="meses"
            aria-invalid={Boolean(monthsError)}
          />
        </FormField>
        <FormField id="review-last" label="Última revisión completa" error={lastError}>
          <Input
            id="review-last"
            type="date"
            max={today}
            value={last}
            onChange={(e) => setLast(e.target.value)}
            aria-invalid={Boolean(lastError)}
          />
        </FormField>
      </div>
      {due && (
        <p className="text-label text-muted-foreground">
          La próxima revisión vence el{' '}
          <span className="font-medium text-foreground">{formatBusinessDateLong(due)}</span>. Desde
          15 días antes se te pedirá programar el día.
        </p>
      )}
      <div>
        <Button disabled={!dirty || pending || Boolean(monthsError || lastError)} onClick={save}>
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          Guardar
        </Button>
      </div>
    </>
  )
}
