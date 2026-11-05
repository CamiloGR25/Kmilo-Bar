import { useMemo, useState } from 'react'
import {
  ArrowRightLeft,
  Ban,
  BellRing,
  Check,
  Loader2,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  Share2,
  Trash2,
  Undo2,
} from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Page, PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { formatCop } from '@/domain/money'
import { useAuth } from '@/features/auth/use-auth'
import { PaymentDialog } from '@/features/cash/components/payment-dialog'
import { methodLabel } from '@/features/cash/domain/payments'
import { usePaymentsOfOrder } from '@/features/cash/services/payments-service'
import { stockLevel } from '@/features/inventory/domain/stock'
import { useInventory, type InventoryItem } from '@/features/inventory/hooks/use-inventory'
import { useTables } from '@/features/tables/services/tables-service'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'
import {
  groupLines,
  canCloseWithoutConsumption,
  changeRoundQty,
  openedText,
  isOpen,
  ORDER_STATUS_LABELS,
  OrderError,
  orderTitle,
  roundTotal,
  type Order,
  type LineGroup,
  type RoundItem,
} from '../domain/orders'
import {
  addLine,
  closeWithoutConsumption,
  newId,
  setOrderStatus,
  useOrder,
} from '../services/orders-service'
import { CancelLineDialog, LabelDialog, MoveOrderDialog, Stepper } from './order-dialogs'
import { ProductPicker } from './product-picker'
import { ShareReceiptDialog } from './share-receipt-dialog'

const errorText = (e: unknown) =>
  e instanceof OrderError ? e.message : `No se pudo guardar: ${(e as Error).message}`

/** Cuenta de mesa o de barra (DESIGN_SYSTEM §8.3). */
export function OrderPage() {
  const { id } = useParams()
  const order = useOrder(id)

  if (order.loading) {
    return (
      <Page wide>
        <div className="h-10 w-48 animate-pulse rounded-lg bg-card" />
        <div className="h-72 animate-pulse rounded-xl bg-card" />
      </Page>
    )
  }
  if (order.error || !order.data) {
    return (
      <Page>
        <PageHeader title="Cuenta" back={{ to: '/mesas', label: 'Mesas' }} />
        <p role="alert" className="text-label text-destructive">
          {order.error ? `No se pudo cargar: ${order.error.message}` : 'La cuenta no existe.'}
        </p>
      </Page>
    )
  }
  return <OrderView order={order.data} />
}

function OrderView({ order }: { order: Order }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const uid = user?.uid ?? ''
  const now = useNow()
  const inventory = useInventory()
  const tables = useTables()
  const open = isOpen(order.status)

  const [round, setRound] = useState<RoundItem[]>([])
  const [confirming, setConfirming] = useState(false)
  const [roundErrors, setRoundErrors] = useState<Record<string, string>>({})
  const [cancelling, setCancelling] = useState<LineGroup | null>(null)
  const [moving, setMoving] = useState(false)
  const [naming, setNaming] = useState(false)
  const [closing, setClosing] = useState(false)
  const [statusPending, setStatusPending] = useState(false)
  const [paying, setPaying] = useState(false)
  const [sharing, setSharing] = useState(false)
  const payments = usePaymentsOfOrder(order.id)

  const itemsById = useMemo(
    () => new Map((inventory.items ?? []).map((i) => [i.product.id, i])),
    [inventory.items],
  )
  const inRound = useMemo(() => new Map(round.map((r) => [r.productId, r.qty])), [round])
  const roundSum = roundTotal(round, (pid) => itemsById.get(pid)?.product.salePrice ?? 0)
  const roundUnits = round.reduce((n, r) => n + r.qty, 0)
  const back =
    order.type === 'barra' ? { to: '/barra', label: 'Barra' } : { to: '/mesas', label: 'Mesas' }

  function changeQty(productId: string, delta: number) {
    const stock = itemsById.get(productId)?.product.stock ?? 0
    setRound((r) => changeRoundQty(r, productId, delta, stock, newId))
    setRoundErrors((e) => {
      const { [productId]: _, ...rest } = e
      return rest
    })
  }

  /** Confirma la ronda: una transacción por línea (D-217). Las que fallan quedan en la ronda. */
  async function confirmRound() {
    if (round.length === 0) return
    setConfirming(true)
    const failed: RoundItem[] = []
    const errors: Record<string, string> = {}
    let done = 0
    for (const item of round) {
      try {
        const res = await addLine(uid, order.id, item)
        done++
        const s = inventory.settings
        if (s) {
          const level = stockLevel(res.stockAfter, res.minStock, s.nearMinFactorBp)
          // R-INV-09: aviso al quedar en mínimo o agotado.
          if (level === 'agotado') toast.warning(`${res.productName} quedó agotado`)
          else if (level === 'minimo')
            toast.warning(`${res.productName} quedó en mínimo: quedan ${res.stockAfter}`)
        }
      } catch (e) {
        failed.push(item)
        errors[item.productId] = errorText(e)
      }
    }
    setRound(failed)
    setRoundErrors(errors)
    setConfirming(false)
    if (done > 0)
      toast.success(
        done === 1 ? 'Producto agregado a la cuenta' : `${done} productos agregados a la cuenta`,
      )
    if (failed.length > 0) toast.error('Algunos productos no se pudieron agregar. Revisa la ronda.')
  }

  async function toggleBill() {
    setStatusPending(true)
    try {
      await setOrderStatus(order.id, order.status === 'por_cobrar' ? 'abierta' : 'por_cobrar')
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setStatusPending(false)
    }
  }

  // D-218: un renglón por producto; por dentro siguen las líneas de cada ronda.
  const groups = groupLines(order.lines)

  const roundPanel = (
    <RoundPanel
      round={round}
      itemsById={itemsById}
      errors={roundErrors}
      total={roundSum}
      units={roundUnits}
      confirming={confirming}
      onChange={changeQty}
      onClear={() => {
        setRound([])
        setRoundErrors({})
      }}
      onConfirm={confirmRound}
    />
  )

  return (
    <Page wide>
      <PageHeader
        title={orderTitle(order)}
        back={back}
        description={
          <>
            Cuenta #{order.number}, {openedText(order.openedAt, now)}.{' '}
            <span
              className={cn(
                'font-medium',
                order.status === 'abierta' && 'text-primary-text',
                order.status === 'por_cobrar' && 'text-warning',
                !open && 'text-muted-foreground',
              )}
            >
              {ORDER_STATUS_LABELS[order.status]}
            </span>
          </>
        }
        actions={
          open && order.type === 'barra' ? (
            <Button variant="outline" onClick={() => setNaming(true)}>
              <Pencil aria-hidden />
              Nombre
            </Button>
          ) : undefined
        }
      />

      <div className={cn('grid gap-8 [&>*]:min-w-0', open && 'lg:grid-cols-[1fr_24rem]')}>
        {/* Cuenta */}
        <div className={cn('flex flex-col gap-4', open && 'lg:order-2')}>
          <section aria-labelledby="consumo" className="flex flex-col rounded-xl border bg-card">
            <h2 id="consumo" className="sr-only">
              Consumo
            </h2>
            {order.lines.length === 0 ? (
              <p className="px-4 py-6 text-label text-muted-foreground">
                {open
                  ? 'Aún no hay productos. Elige los productos y confirma la ronda.'
                  : 'Sin productos.'}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {groups.map((g) => {
                  const p = itemsById.get(g.productId)?.product
                  const picked = inRound.get(g.productId) ?? 0
                  return (
                    <GroupRow
                      key={g.key}
                      group={g}
                      open={open}
                      inRound={picked}
                      canAdd={
                        !confirming && !!p && p.active && p.salePrice > 0 && p.stock - picked > 0
                      }
                      onAdd={() => changeQty(g.productId, 1)}
                      onCancel={() => setCancelling(g)}
                    />
                  )
                })}
              </ul>
            )}
            <div className="flex items-baseline justify-between gap-4 border-t px-4 py-4">
              <span className="text-label text-muted-foreground">Total</span>
              <span className="tabular text-figure font-semibold">{formatCop(order.total)}</span>
            </div>
            {(payments.data ?? []).length > 0 && (
              <div className="flex flex-col gap-1.5 border-t px-4 py-3">
                {(payments.data ?? []).map((p) => (
                  <p key={p.id} className="flex justify-between gap-3 text-label">
                    <span className="text-muted-foreground">
                      Pagó con {methodLabel(p)}
                      {p.change > 0 && `, cambio ${formatCop(p.change)}`}
                    </span>
                    <span className="tabular">{formatCop(p.amount)}</span>
                  </p>
                ))}
                <p className="flex justify-between gap-3 pt-1 font-medium">
                  <span>{order.balance > 0 ? 'Saldo por cobrar' : 'Pagada'}</span>
                  <span className={cn('tabular', order.balance > 0 && 'text-warning')}>
                    {formatCop(order.balance)}
                  </span>
                </p>
              </div>
            )}
          </section>

          {open && <div className="hidden lg:block">{roundPanel}</div>}

          {open && (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={order.status === 'por_cobrar' ? 'outline' : 'secondary'}
                  onClick={toggleBill}
                  disabled={statusPending || order.lines.length === 0}
                >
                  {statusPending ? (
                    <Loader2 aria-hidden className="animate-spin" />
                  ) : order.status === 'por_cobrar' ? (
                    <RotateCcw aria-hidden />
                  ) : (
                    <BellRing aria-hidden />
                  )}
                  {order.status === 'por_cobrar' ? 'Reabrir' : 'Pedir cuenta'}
                </Button>
                <Button variant="outline" onClick={() => setMoving(true)}>
                  <ArrowRightLeft aria-hidden />
                  {order.type === 'barra' ? 'Pasar a mesa' : 'Mover'}
                </Button>
              </div>
              <Button
                size="lg"
                onClick={() => {
                  if (round.length > 0) {
                    toast.warning('Confirma o vacía la ronda antes de cobrar.')
                    return
                  }
                  setPaying(true)
                }}
                disabled={order.balance === 0 || confirming}
              >
                <ReceiptText aria-hidden />
                Cobrar {formatCop(order.balance)}
              </Button>
              {order.lines.length > 0 && (
                <Button variant="outline" onClick={() => setSharing(true)}>
                  <Share2 aria-hidden />
                  Resumen para el cliente
                </Button>
              )}
              {canCloseWithoutConsumption(order) && (
                <Button variant="destructive" onClick={() => setClosing(true)}>
                  <Ban aria-hidden />
                  Cerrar sin consumo
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Productos */}
        {open && (
          <div className="flex flex-col gap-4 pb-28 lg:order-1 lg:pb-0">
            {inventory.error ? (
              <p role="alert" className="text-label text-destructive">
                No se pudieron cargar los productos: {inventory.error.message}
              </p>
            ) : !inventory.items ? (
              <div className="h-72 animate-pulse rounded-xl bg-card" />
            ) : (
              <ProductPicker
                items={inventory.items}
                categories={inventory.categories}
                inRound={inRound}
                disabled={confirming}
                onPick={(i: InventoryItem) => changeQty(i.product.id, 1)}
              />
            )}
          </div>
        )}
      </div>

      {/* Ronda en el celular: barra fija sobre la navegación inferior */}
      {open && round.length > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-30 border-t bg-card/95 px-4 pt-3 pb-3 backdrop-blur lg:hidden">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <span className="text-label">
                Ronda: <span className="tabular font-semibold text-foreground">{roundUnits}</span>{' '}
                {roundUnits === 1 ? 'producto' : 'productos'},{' '}
                <span className="tabular font-semibold text-foreground">{formatCop(roundSum)}</span>
                <span className="ml-2 text-meta text-primary-text group-open:hidden">Ver</span>
              </span>
              <Button
                onClick={(e) => {
                  e.preventDefault()
                  void confirmRound()
                }}
                disabled={confirming}
              >
                {confirming ? (
                  <Loader2 aria-hidden className="animate-spin" />
                ) : (
                  <Check aria-hidden />
                )}
                Confirmar
              </Button>
            </summary>
            <div className="mt-3 max-h-[45dvh] overflow-y-auto">{roundPanel}</div>
          </details>
        </div>
      )}

      {!open && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-label text-muted-foreground">
            Esta cuenta está cerrada y no se puede modificar.{' '}
            <Link to="/cuentas" className="text-primary-text hover:underline">
              Ver historial de cuentas
            </Link>
          </p>
          {order.lines.length > 0 && (
            <Button variant="outline" onClick={() => setSharing(true)}>
              <Share2 aria-hidden />
              Resumen para el cliente
            </Button>
          )}
        </div>
      )}

      {open && (
        <PaymentDialog
          order={order}
          open={paying}
          onOpenChange={setPaying}
          onPaid={() => navigate(back.to)}
        />
      )}
      <ShareReceiptDialog
        order={order}
        payments={payments.data ?? []}
        open={sharing}
        onOpenChange={setSharing}
      />

      <CancelLineDialog
        order={order}
        group={cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
      />
      <MoveOrderDialog
        order={order}
        tables={tables.data ?? []}
        open={moving}
        onOpenChange={setMoving}
      />
      {naming && <LabelDialog order={order} open={naming} onOpenChange={setNaming} />}
      <ConfirmDialog
        open={closing}
        onOpenChange={setClosing}
        title="Cerrar sin consumo"
        description={`${orderTitle(order)} no tiene nada por cobrar. Se cerrará la cuenta${order.type === 'mesa' ? ' y se liberará la mesa' : ''}.`}
        confirmLabel="Cerrar cuenta"
        destructive
        onConfirm={async () => {
          try {
            await closeWithoutConsumption(uid, order.id, null)
            toast.success('Cuenta cerrada sin consumo')
            navigate(back.to)
          } catch (e) {
            toast.error(errorText(e))
          }
        }}
      />
    </Page>
  )
}

/**
 * Un renglón por producto (D-218): suma todas las rondas de ese producto. "+" agrega una
 * unidad a la ronda sin buscarlo otra vez; cancelar reparte entre sus rondas.
 */
function GroupRow({
  group,
  open,
  inRound,
  canAdd,
  onAdd,
  onCancel,
}: {
  group: LineGroup
  open: boolean
  /** Unidades de este producto esperando confirmación en la ronda. */
  inRound: number
  canAdd: boolean
  onAdd: () => void
  onCancel: () => void
}) {
  const active = group.activeQty
  return (
    <li className={cn('flex items-center gap-2 px-4 py-3', active === 0 && 'opacity-60')}>
      <div className="min-w-0 flex-1">
        <p className={cn('font-medium', active === 0 && 'line-through')}>{group.nameSnap}</p>
        <p className="tabular text-meta text-subtle-foreground">
          {active} × {formatCop(group.unitPrice)}
          {group.cancelledQty > 0 &&
            `, ${group.cancelledQty} cancelada${group.cancelledQty > 1 ? 's' : ''}`}
          {group.lostQty > 0 && `, ${group.lostQty} perdida${group.lostQty > 1 ? 's' : ''}`}
        </p>
        {inRound > 0 && (
          <p className="tabular text-meta text-primary-text">
            +{inRound} en la ronda por confirmar
          </p>
        )}
      </div>
      <span className="tabular font-semibold">{formatCop(active * group.unitPrice)}</span>
      {open && (
        <span className="flex items-center">
          {active > 0 && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Cancelar ${group.nameSnap}`}
              onClick={onCancel}
              className="text-muted-foreground hover:text-destructive"
            >
              <Undo2 aria-hidden />
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            aria-label={`Pedir otra ${group.nameSnap}`}
            title={canAdd ? 'Agregar una más a la ronda' : 'Sin stock disponible'}
            disabled={!canAdd}
            onClick={onAdd}
          >
            <Plus aria-hidden />
          </Button>
        </span>
      )}
    </li>
  )
}

function RoundPanel({
  round,
  itemsById,
  errors,
  total,
  units,
  confirming,
  onChange,
  onClear,
  onConfirm,
}: {
  round: RoundItem[]
  itemsById: Map<string, InventoryItem>
  errors: Record<string, string>
  total: number
  units: number
  confirming: boolean
  onChange: (productId: string, delta: number) => void
  onClear: () => void
  onConfirm: () => void
}) {
  if (round.length === 0) {
    return (
      <p className="rounded-xl border border-dashed px-4 py-4 text-label text-muted-foreground">
        Toca los productos para armar la ronda. El inventario se descuenta al confirmarla.
      </p>
    )
  }
  return (
    <section
      aria-labelledby="ronda"
      className="flex flex-col gap-3 rounded-xl border border-primary/50 bg-primary/6 p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="ronda" className="text-title font-semibold">
          Ronda por confirmar
        </h2>
        <span className="tabular text-label text-muted-foreground">
          {units} {units === 1 ? 'producto' : 'productos'}
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {round.map((r) => {
          const item = itemsById.get(r.productId)
          const name = item?.product.name ?? 'Producto'
          return (
            <li key={r.productId} className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{name}</p>
                  <p className="tabular text-meta text-subtle-foreground">
                    {formatCop((item?.product.salePrice ?? 0) * r.qty)}
                  </p>
                </div>
                <Stepper
                  value={r.qty}
                  min={0}
                  max={item?.product.stock ?? r.qty}
                  label={name}
                  onChange={(v) => onChange(r.productId, v - r.qty)}
                />
              </div>
              {errors[r.productId] && (
                <p role="alert" className="text-meta text-destructive">
                  {errors[r.productId]}
                </p>
              )}
            </li>
          )
        })}
      </ul>
      <div className="flex items-baseline justify-between gap-3 border-t border-primary/30 pt-3">
        <span className="text-label text-muted-foreground">Total de la ronda</span>
        <span className="tabular text-title font-semibold">{formatCop(total)}</span>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <Button
          variant="outline"
          onClick={onClear}
          disabled={confirming}
          aria-label="Vaciar la ronda"
        >
          <Trash2 aria-hidden />
        </Button>
        <Button onClick={onConfirm} disabled={confirming}>
          {confirming ? <Loader2 aria-hidden className="animate-spin" /> : <Check aria-hidden />}
          Confirmar ronda
        </Button>
      </div>
    </section>
  )
}
