import { useMemo, useState } from 'react'
import { Check, ClipboardList, Copy, Loader2, PartyPopper } from 'lucide-react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { NativeSelect } from '@/components/shared/inputs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAuth } from '@/features/auth/use-auth'
import {
  describeQty,
  pendingByProduct,
  purchaseUnitOf,
  type Supplier,
} from '@/features/purchases/domain/purchases'
import {
  createPurchaseOrder,
  newId,
  usePurchaseOrders,
  useSuppliers,
} from '@/features/purchases/services/purchases-service'
import { Page, PageHeader } from '@/components/shared/page-header'
import { StockIndicator } from '@/components/shared/stock-indicator'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { bpToPercent, formatCop } from '@/domain/money'
import { CategoryIcon } from '@/features/products/components/category-icon'
import { MIN_DAYS_FOR_SUGGESTION, recommendedOrderQty } from '../domain/stock'
import { useInventory, type InventoryItem } from '../hooks/use-inventory'

/**
 * Recomendaciones de pedido (D-102, R-INV-08): productos en mínimo o agotados con la cantidad
 * sugerida para volver al stock objetivo, descontando lo ya pedido y redondeando a la unidad de
 * compra. "Crear pedidos" arma un borrador por proveedor habitual (D-223 #5).
 */
export function RecommendationsPage() {
  const { items, settings, loading } = useInventory()
  const orders = usePurchaseOrders()
  const suppliers = useSuppliers()
  const [includeNear, setIncludeNear] = useState(false)
  const [copied, setCopied] = useState(false)
  const [creating, setCreating] = useState(false)

  const pending = useMemo(() => pendingByProduct(orders.data ?? []), [orders.data])

  const list = useMemo(
    () =>
      (items ?? [])
        .map((i) => ({
          ...i,
          pendingQty: pending.get(i.product.id) ?? 0,
          suggestedQty: settings
            ? recommendedOrderQty(
                i.product.stock,
                i.product.minStock,
                settings.targetStockFactorBp,
                pending.get(i.product.id) ?? 0,
                i.product.unitsPerPurchase ?? 1,
              )
            : i.suggestedQty,
        }))
        .filter(
          (i) =>
            (i.suggestedQty > 0 || i.pendingQty > 0) &&
            (i.level === 'agotado' || i.level === 'minimo' || (includeNear && i.level === 'cerca')),
        ),
    [items, includeNear, pending, settings],
  )
  const toOrder = list.filter((i) => i.suggestedQty > 0)

  const groups = useMemo(() => {
    const m = new Map<string, Suggested[]>()
    for (const i of list) {
      const key = i.category?.name ?? 'Sin categoría'
      m.set(key, [...(m.get(key) ?? []), i])
    }
    return [...m.entries()]
  }, [list])

  const unitCost = (i: InventoryItem) => i.product.lastPurchaseCost || i.product.avgCost
  const total = toOrder.reduce((acc, i) => acc + i.suggestedQty * unitCost(i), 0)

  async function copy() {
    const text = [
      `Pedido ${settings?.businessName ?? ''}`.trim(),
      ...groups.flatMap(([cat, its]) => [
        '',
        cat,
        ...its
          .filter((i) => i.suggestedQty > 0)
          .map(
            (i) => `- ${i.product.name}: ${describeQty(i.suggestedQty, purchaseUnitOf(i.product))}`,
          ),
      ]),
    ].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Page wide>
      <PageHeader
        title="Qué pedir"
        description={
          settings
            ? `Cantidad para volver a ${bpToPercent(settings.targetStockFactorBp) / 100} veces el stock mínimo, según el último costo de compra.`
            : undefined
        }
        back={{ to: '/inventario', label: 'Inventario' }}
        actions={
          toOrder.length > 0 && (
            <>
              <Button variant="outline" onClick={copy}>
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? 'Lista copiada' : 'Copiar lista'}
              </Button>
              <Button onClick={() => setCreating(true)}>
                <ClipboardList aria-hidden />
                Crear pedidos
              </Button>
            </>
          )
        }
      />

      <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border bg-card px-5 py-4">
        <span>
          <span className="block font-medium">Incluir productos cerca del mínimo</span>
          <span className="text-meta text-subtle-foreground">
            Útil para aprovechar un mismo pedido al proveedor.
          </span>
        </span>
        <Switch checked={includeNear} onCheckedChange={setIncludeNear} />
      </label>

      {loading ? (
        <p className="inline-flex items-center gap-2 text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Cargando…
        </p>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed bg-card p-6">
          <PartyPopper aria-hidden className="size-7 text-success" />
          <p className="text-title font-semibold">No hay nada urgente por pedir</p>
          <p className="text-label text-muted-foreground">
            Ningún producto activo está agotado ni en su stock mínimo.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-label text-muted-foreground">
              {toOrder.length === 1
                ? '1 producto por pedir'
                : `${toOrder.length} productos por pedir`}
            </p>
            <p className="text-label text-muted-foreground">
              Costo estimado:{' '}
              <span className="tabular text-lg font-semibold text-foreground">
                {formatCop(total)}
              </span>
            </p>
          </div>
          {groups.map(([cat, its]) => (
            <section key={cat} className="flex flex-col gap-3">
              <h2 className="text-title font-semibold">{cat}</h2>
              <ul className="divide-y divide-border rounded-xl border bg-card">
                {its.map((i) => (
                  <li key={i.product.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <CategoryIcon icon={i.category?.icon ?? 'package'} />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 leading-snug font-medium">{i.product.name}</p>
                      <p className="text-meta text-subtle-foreground">
                        Hay {i.product.stock}, mínimo {i.product.minStock}
                        {i.pendingQty > 0 && `, ya pedido ${i.pendingQty}`}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <p className="text-right tabular text-lg leading-none font-semibold">
                        {i.suggestedQty > 0 ? `Pedir ${i.suggestedQty}` : 'Ya está pedido'}
                      </p>
                      {i.suggestedQty > 0 && purchaseUnitOf(i.product) && (
                        <p className="text-meta text-subtle-foreground">
                          {describeQty(i.suggestedQty, purchaseUnitOf(i.product))}
                        </p>
                      )}
                      <StockIndicator level={i.level} className="text-meta" />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}

      <CreateOrdersDialog
        open={creating}
        onOpenChange={setCreating}
        items={toOrder}
        suppliers={suppliers.data ?? []}
      />

      <p className="text-meta text-subtle-foreground">
        El stock mínimo sugerido según tus ventas estará disponible tras {MIN_DAYS_FOR_SUGGESTION}{' '}
        jornadas con ventas (Fase 4 en adelante). Mientras tanto se usa el mínimo que definiste en
        cada producto.
      </p>
    </Page>
  )
}

type Suggested = InventoryItem & { pendingQty: number }

/**
 * Crear pedidos desde "Qué pedir" (D-223 #5): un borrador por proveedor habitual; los productos
 * sin proveedor van al que se escoja aquí. Después se revisan y se envían desde Compras.
 */
function CreateOrdersDialog({
  open,
  onOpenChange,
  items,
  suppliers,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: Suggested[]
  suppliers: Supplier[]
}) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [fallback, setFallback] = useState('')
  const [pending, setPending] = useState(false)
  const active = suppliers.filter((s) => s.active)
  const byId = new Map(suppliers.map((s) => [s.id, s]))

  const groups = new Map<string, Suggested[]>()
  for (const i of items) {
    const sid =
      i.product.supplierId && byId.get(i.product.supplierId)?.active ? i.product.supplierId : ''
    groups.set(sid, [...(groups.get(sid) ?? []), i])
  }
  const unassigned = groups.get('') ?? []

  async function create() {
    setPending(true)
    try {
      let n = 0
      for (const [sid, its] of groups) {
        const supplier = byId.get(sid || fallback)
        if (!supplier) continue
        await createPurchaseOrder(user?.uid ?? '', newId(), 'pedido', {
          supplier,
          lines: its.map((i) => ({
            productId: i.product.id,
            name: i.product.name,
            qty: i.suggestedQty,
            estUnitCost:
              supplier.lastCosts[i.product.id] ?? (i.product.lastPurchaseCost || i.product.avgCost),
          })),
          expectedDate: null,
          notes: '',
        })
        n++
      }
      toast.success(n === 1 ? 'Pedido creado como borrador' : `${n} pedidos creados como borrador`)
      onOpenChange(false)
      navigate('/compras')
    } catch (e) {
      toast.error(`No se pudieron crear: ${(e as Error).message}`)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-title">Crear pedidos</DialogTitle>
          <DialogDescription className="text-label">
            Se crea un borrador por proveedor con las cantidades sugeridas. Antes de enviarlos
            puedes revisarlos y editarlos en Compras.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {[...groups.entries()]
            .filter(([sid]) => sid)
            .map(([sid, its]) => (
              <li
                key={sid}
                className="flex justify-between gap-4 rounded-lg bg-raised/60 px-4 py-2.5"
              >
                <span className="font-medium">{byId.get(sid)?.name}</span>
                <span className="text-label text-muted-foreground">
                  {its.length} {its.length === 1 ? 'producto' : 'productos'}
                </span>
              </li>
            ))}
        </ul>
        {unassigned.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-label">
              {unassigned.length === 1
                ? '1 producto no tiene'
                : `${unassigned.length} productos no tienen`}{' '}
              proveedor habitual. ¿A quién se los pides?
            </p>
            <NativeSelect value={fallback} onChange={(e) => setFallback(e.target.value)}>
              <option value="">No pedirlos ahora</option>
              {active.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
            {active.length === 0 && (
              <p className="text-meta text-subtle-foreground">
                Primero crea un proveedor en Proveedores.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            disabled={pending || ([...groups.keys()].every((k) => !k) && !fallback)}
            onClick={create}
          >
            {pending && <Loader2 aria-hidden className="animate-spin" />}
            Crear borradores
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
