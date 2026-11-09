import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { NativeSelect } from '@/components/shared/inputs'
import { Page, PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { businessDateOf } from '@/domain/dates'
import { useAuth } from '@/features/auth/use-auth'
import type { Product } from '@/features/products/domain/catalog'
import { useProducts } from '@/features/products/services/catalog-service'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase/firestore'
import {
  planReception,
  validateLines,
  type PurchaseOrder,
  type Supplier,
} from '../domain/purchases'
import {
  createPurchaseOrder,
  markRequested,
  newId,
  purchaseOrderFromDoc,
  receivePurchase,
  updateDraft,
  usePurchaseOrder,
  useSuppliers,
} from '../services/purchases-service'
import { newLine, toDraft, type EditableLine } from '../domain/editable-lines'
import { LineEditor } from './purchase-lines'
import { SupplierDialog } from './suppliers-page'

/**
 * Nuevo pedido, editar un borrador o compra directa ("Llegó mercancía", D-223 #1).
 * La compra directa se crea y se recibe en un paso; después se ofrece registrar el pago.
 */
export function PurchaseFormPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const direct = !id && params.get('tipo') === 'directa'
  const suppliers = useSuppliers()
  const products = useProducts()
  const existing = usePurchaseOrder(id)

  const title = id ? 'Editar pedido' : direct ? 'Llegó mercancía' : 'Nuevo pedido'
  const loading = suppliers.loading || products.loading || (Boolean(id) && existing.loading)

  return (
    <Page>
      <PageHeader
        title={title}
        description={
          direct
            ? 'Registra lo que llegó sin pedido previo: sube el inventario con el costo real.'
            : 'Guárdalo como borrador para terminarlo después, o regístralo: queda por recibir, lo envíes o no al proveedor.'
        }
        back={{ to: id ? `/compras/${id}` : '/compras', label: id ? 'Pedido' : 'Compras' }}
      />
      {loading ? (
        <p className="inline-flex items-center gap-2 text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Cargando…
        </p>
      ) : id && existing.data?.status !== 'borrador' ? (
        <p className="text-destructive">Solo se puede editar un pedido en borrador.</p>
      ) : (
        <PurchaseForm
          direct={direct}
          order={existing.data ?? null}
          suppliers={suppliers.data ?? []}
          products={products.data ?? []}
          initialSupplierId={params.get('proveedor')}
        />
      )}
    </Page>
  )
}

function initialLines(order: PurchaseOrder | null, products: Product[]): EditableLine[] {
  if (!order) return []
  const byId = new Map(products.map((p) => [p.id, p]))
  return order.lines.map((l) => {
    const p = byId.get(l.productId)
    if (!p) {
      return {
        productId: l.productId,
        name: l.nameSnap,
        unit: null,
        mode: 'unidad',
        qty: l.qtyOrdered,
        cost: l.estUnitCost,
      }
    }
    return newLine(p, l.estUnitCost, l.qtyOrdered)
  })
}

function PurchaseForm({
  direct,
  order,
  suppliers,
  products,
  initialSupplierId,
}: {
  direct: boolean
  order: PurchaseOrder | null
  suppliers: Supplier[]
  products: Product[]
  initialSupplierId: string | null
}) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const uid = user?.uid ?? ''
  const [opId] = useState(newId)
  const [supplierId, setSupplierId] = useState(order?.supplierId ?? initialSupplierId ?? '')
  const [lines, setLines] = useState<EditableLine[]>(() => initialLines(order, products))
  const [expectedDate, setExpectedDate] = useState(order?.expectedDate ?? '')
  const [notes, setNotes] = useState(order?.notes ?? '')
  const [creatingSupplier, setCreatingSupplier] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supplier = suppliers.find((s) => s.id === supplierId)
  const selectable = suppliers.filter((s) => s.active || s.id === supplierId)
  // Costo de referencia: el último de este proveedor, si no el último del producto (D-223 #8).
  const costOf = (p: Product) => supplier?.lastCosts[p.id] ?? (p.lastPurchaseCost || p.avgCost)

  /** `register`: el pedido queda solicitado (registrado) sin necesidad de enviarlo. */
  async function submit(register: boolean) {
    setError(null)
    if (!supplier) {
      setError('Escoge el proveedor.')
      return
    }
    const drafts = lines.map(toDraft)
    const invalid = validateLines(drafts)
    if (invalid) {
      setError(invalid)
      return
    }
    const today = businessDateOf(new Date())
    if (!direct && expectedDate && expectedDate < today) {
      setError('La fecha de entrega no puede ser pasada.')
      return
    }
    setPending(true)
    try {
      const input = {
        supplier,
        lines: drafts,
        expectedDate: direct ? null : expectedDate || null,
        notes,
      }
      if (order) {
        await updateDraft(uid, order.id, input)
        if (register) await markRequested(uid, order.id)
        toast.success(register ? `Pedido #${order.number} registrado` : 'Borrador guardado')
        navigate('/compras')
        return
      }
      const number = await createPurchaseOrder(
        uid,
        opId,
        direct ? 'directa' : 'pedido',
        input,
        register,
      )
      if (direct) {
        // Se recibe todo lo escrito, al costo escrito (es el costo real).
        await receiveAll(uid, opId, notes)
        toast.success(`Compra #${number} registrada: inventario actualizado`)
        navigate(`/compras/${opId}?pagar=1`)
      } else {
        toast.success(
          register ? `Pedido #${number} registrado` : `Pedido #${number} guardado como borrador`,
        )
        navigate('/compras')
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4 rounded-xl border bg-card p-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="supplier">Proveedor</Label>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <NativeSelect
                id="supplier"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">Escoge el proveedor…</option>
                {selectable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button variant="outline" onClick={() => setCreatingSupplier(true)}>
              <Plus aria-hidden />
              Nuevo
            </Button>
          </div>
        </div>
        {!direct && (
          <div className="flex flex-col gap-2 sm:max-w-xs">
            <Label htmlFor="expected">Entrega esperada (opcional)</Label>
            <Input
              id="expected"
              type="date"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
            />
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">Productos</h2>
        <LineEditor
          lines={lines}
          onChange={setLines}
          products={products}
          costOf={costOf}
          costLabel={direct ? 'Costo real' : 'Costo'}
        />
      </section>

      <section className="flex flex-col gap-2">
        <Label htmlFor="notes">Notas (opcional)</Label>
        <Textarea
          id="notes"
          maxLength={300}
          placeholder={
            direct ? 'Número de factura, observaciones…' : 'Indicaciones para el proveedor…'
          }
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </section>

      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => navigate(order ? `/compras/${order.id}` : '/compras')}
        >
          Cancelar
        </Button>
        {direct ? (
          <Button disabled={pending} onClick={() => submit(true)}>
            {pending && <Loader2 aria-hidden className="animate-spin" />}
            Registrar y subir inventario
          </Button>
        ) : (
          <>
            <Button variant="outline" disabled={pending} onClick={() => submit(false)}>
              Guardar borrador
            </Button>
            <Button disabled={pending} onClick={() => submit(true)}>
              {pending && <Loader2 aria-hidden className="animate-spin" />}
              Registrar pedido
            </Button>
          </>
        )}
      </div>

      <SupplierDialog
        open={creatingSupplier}
        onOpenChange={setCreatingSupplier}
        supplier={null}
        allSuppliers={suppliers}
        onCreated={setSupplierId}
      />
    </div>
  )
}

/** Compra directa: recibe todas las líneas del pedido recién creado, a su costo. */
async function receiveAll(uid: string, orderId: string, notes: string) {
  const snap = await getDoc(doc(db, 'purchaseOrders', orderId))
  const order = purchaseOrderFromDoc(orderId, snap.data() ?? {})
  const plan = planReception(
    order,
    order.lines.map((l) => ({ lineId: l.lineId, qty: l.qtyOrdered, unitCost: l.estUnitCost })),
  )
  await receivePurchase(uid, orderId, `${orderId}r`, plan, notes)
}
