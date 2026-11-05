import { useMemo, useState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { IntegerInput, MoneyInput, NativeSelect } from '@/components/shared/inputs'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { formatCop } from '@/domain/money'
import { FormField } from '@/features/auth/components/form-field'
import { useAuth } from '@/features/auth/use-auth'
import type { Product } from '@/features/products/domain/catalog'
import {
  applyMovement,
  COSTED_ENTRIES,
  InventoryError,
  MOVEMENT_LABELS,
  requiresReason,
  type ManualMovementType,
} from '../domain/movements'
import { newOpId, registerMovement } from '../services/inventory-service'

const GROUPS: { label: string; types: ManualMovementType[] }[] = [
  { label: 'Entradas', types: ['entrada_manual', 'entrada_inicial'] },
  { label: 'Salidas', types: ['merma', 'danado', 'vencido', 'cortesia', 'consumo_propio'] },
  { label: 'Correcciones', types: ['ajuste_positivo', 'ajuste_negativo'] },
]

const HINTS: Partial<Record<ManualMovementType, string>> = {
  entrada_inicial: 'Para cargar el stock que ya tienes antes de empezar a usar el sistema.',
  entrada_manual: 'Mercancía que llegó sin un pedido registrado. El costo actualiza el promedio.',
  merma: 'Producto que se perdió (derramado, roto al servir).',
  cortesia: 'Producto regalado a un cliente. Cuenta como costo, no como venta.',
  consumo_propio: 'Lo que consumes tú o tu equipo.',
  ajuste_positivo:
    'Corrige un faltante registrado por error. Para cuadrar todo, usa el conteo físico.',
  ajuste_negativo: 'Corrige un sobrante registrado por error.',
}

/** Registrar un movimiento manual de inventario para un producto. */
export function MovementDialog({
  product,
  open,
  onOpenChange,
}: {
  product: Product
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* key: un formulario (y un opId) nuevo cada vez que se abre */}
        {open && (
          <MovementForm key={product.id} product={product} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function MovementForm({ product, onDone }: { product: Product; onDone: () => void }) {
  const { user } = useAuth()
  const [opId] = useState(newOpId)
  const [type, setType] = useState<ManualMovementType>(
    product.stock === 0 ? 'entrada_inicial' : 'entrada_manual',
  )
  const [quantity, setQuantity] = useState<number | null>(null)
  const [unitCost, setUnitCost] = useState<number | null>(
    product.lastPurchaseCost || product.avgCost,
  )
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)

  const costed = COSTED_ENTRIES.includes(type)
  const needsReason = requiresReason(type)

  const preview = useMemo(() => {
    if (!quantity) return null
    try {
      return {
        result: applyMovement(
          { stock: product.stock, avgCost: product.avgCost },
          {
            type,
            quantity,
            unitCost: costed ? (unitCost ?? undefined) : undefined,
            reason: needsReason ? reason || 'xxx' : null,
          },
        ),
        error: null,
      }
    } catch (e) {
      return { result: null, error: (e as Error).message }
    }
  }, [product, type, quantity, unitCost, costed, needsReason, reason])

  const reasonMissing = needsReason && reason.trim().length < 3
  const canSubmit =
    !!preview?.result && !reasonMissing && (!costed || unitCost !== null) && !pending

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || !quantity) return
    setPending(true)
    try {
      const created = await registerMovement(user?.uid ?? '', {
        opId,
        productId: product.id,
        type,
        quantity,
        unitCost: costed ? (unitCost ?? undefined) : undefined,
        reason: needsReason ? reason : null,
      })
      toast.success(
        created
          ? `Movimiento registrado: ${MOVEMENT_LABELS[type]}`
          : 'Ese movimiento ya estaba registrado',
      )
      onDone()
    } catch (err) {
      toast.error(
        err instanceof InventoryError
          ? err.message
          : `No se pudo registrar: ${(err as Error).message}`,
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle className="text-title">Movimiento de inventario</DialogTitle>
        <DialogDescription className="text-label">
          {product.name}, stock actual{' '}
          <span className="tabular font-semibold text-foreground">{product.stock}</span>
        </DialogDescription>
      </DialogHeader>

      <FormField id="mov-type" label="Tipo">
        <NativeSelect
          id="mov-type"
          value={type}
          onChange={(e) => setType(e.target.value as ManualMovementType)}
        >
          {GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.types.map((t) => (
                <option key={t} value={t}>
                  {MOVEMENT_LABELS[t]}
                </option>
              ))}
            </optgroup>
          ))}
        </NativeSelect>
      </FormField>
      {HINTS[type] && <p className="-mt-3 text-meta text-subtle-foreground">{HINTS[type]}</p>}

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="mov-qty" label="Cantidad">
          <IntegerInput
            id="mov-qty"
            suffix="unid."
            value={quantity}
            onChange={setQuantity}
            autoFocus
          />
        </FormField>
        {costed && (
          <FormField id="mov-cost" label="Costo por unidad">
            <MoneyInput id="mov-cost" value={unitCost} onChange={setUnitCost} />
          </FormField>
        )}
      </div>

      {needsReason && (
        <FormField id="mov-reason" label="Motivo">
          <Textarea
            id="mov-reason"
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej. Botella rota al servir"
          />
        </FormField>
      )}

      {preview?.error && quantity !== null && (
        <p role="alert" className="text-label text-destructive">
          {preview.error}
        </p>
      )}
      {preview?.result && (
        <div className="flex flex-wrap gap-x-8 gap-y-2 rounded-lg bg-raised px-4 py-3">
          <Change
            label="Stock"
            from={String(preview.result.stockBefore)}
            to={String(preview.result.stockAfter)}
          />
          {preview.result.avgCostAfter !== preview.result.avgCostBefore && (
            <Change
              label="Costo promedio"
              from={formatCop(preview.result.avgCostBefore)}
              to={formatCop(preview.result.avgCostAfter)}
            />
          )}
          {!costed && (
            <p className="text-label text-muted-foreground">
              Valor:{' '}
              <span className="tabular text-foreground">
                {formatCop(Math.abs(preview.result.qty * preview.result.unitCost))}
              </span>
            </p>
          )}
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          Registrar
        </Button>
      </DialogFooter>
    </form>
  )
}

function Change({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <p className="inline-flex items-center gap-2 text-label text-muted-foreground">
      {label}
      <span className="tabular">{from}</span>
      <ArrowRight aria-hidden className="size-4" />
      <span className="tabular font-semibold text-foreground">{to}</span>
    </p>
  )
}
