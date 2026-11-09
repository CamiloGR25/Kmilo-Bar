import { useMemo, useState } from 'react'
import { ChevronRight, Loader2, Plus, Truck } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Page, PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { formatCop } from '@/domain/money'
import { FormField } from '@/features/auth/components/form-field'
import { useAuth } from '@/features/auth/use-auth'
import { cn } from '@/lib/utils'
import { supplierTotals, type Supplier } from '../domain/purchases'
import {
  createSupplier,
  updateSupplier,
  usePurchaseOrders,
  useSuppliers,
  validateSupplier,
  type SupplierInput,
} from '../services/purchases-service'

/** Proveedores (F7-01): lista con lo que se les debe. */
export function SuppliersPage() {
  const suppliers = useSuppliers()
  const orders = usePurchaseOrders()
  const [creating, setCreating] = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const totals = useMemo(() => supplierTotals(orders.data), [orders.data])
  const list = (suppliers.data ?? []).filter((s) => showInactive || s.active)
  const totalDebt = [...totals.values()].reduce((s, t) => s + t.debt, 0)

  return (
    <Page>
      <PageHeader
        title="Proveedores"
        description={
          totalDebt > 0 ? (
            <>
              Les debes en total:{' '}
              <span className="tabular font-semibold text-warning">{formatCop(totalDebt)}</span>
            </>
          ) : (
            'A quién le compras, lo que les has comprado y lo que les debes.'
          )
        }
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            Nuevo proveedor
          </Button>
        }
      />
      {suppliers.loading ? (
        <p className="inline-flex items-center gap-2 text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Cargando…
        </p>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
          <Truck aria-hidden className="size-8 text-muted-foreground" />
          <p className="text-muted-foreground">Todavía no tienes proveedores.</p>
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            Agregar el primero
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border bg-card">
          {list.map((s) => {
            const t = totals.get(s.id)
            return (
              <li key={s.id}>
                <Link
                  to={`/proveedores/${s.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3.5 transition-colors hover:bg-raised sm:px-5"
                >
                  <div className="min-w-0">
                    <p className={cn('font-medium', !s.active && 'text-subtle-foreground')}>
                      {s.name}
                      {!s.active && ' (inactivo)'}
                    </p>
                    <p className="truncate text-meta text-subtle-foreground">
                      {[s.contactName, s.phone].filter(Boolean).join(', ') || 'Sin contacto'}
                      {t?.open ? `. ${t.open} pedido${t.open === 1 ? '' : 's'} por llegar` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {t && t.debt > 0 ? (
                      <span className="text-right">
                        <span className="block text-meta text-muted-foreground">Le debes</span>
                        <span className="tabular font-semibold text-warning">
                          {formatCop(t.debt)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-label text-muted-foreground">Al día</span>
                    )}
                    <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      {(suppliers.data ?? []).some((s) => !s.active) && (
        <button
          type="button"
          onClick={() => setShowInactive((v) => !v)}
          className="w-fit cursor-pointer text-label text-primary-text hover:underline"
        >
          {showInactive ? 'Ocultar inactivos' : 'Ver también los inactivos'}
        </button>
      )}
      <SupplierDialog
        open={creating}
        onOpenChange={setCreating}
        supplier={null}
        allSuppliers={suppliers.data ?? []}
      />
    </Page>
  )
}

/** Crear o editar un proveedor. */
export function SupplierDialog({
  open,
  onOpenChange,
  supplier,
  allSuppliers,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  supplier: Supplier | null
  allSuppliers: Supplier[]
  onCreated?: (id: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && (
          <SupplierForm
            supplier={supplier}
            allSuppliers={allSuppliers}
            onDone={(id) => {
              onOpenChange(false)
              if (id) onCreated?.(id)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function SupplierForm({
  supplier,
  allSuppliers,
  onDone,
}: {
  supplier: Supplier | null
  allSuppliers: Supplier[]
  onDone: (createdId?: string) => void
}) {
  const { user } = useAuth()
  const [v, setV] = useState<SupplierInput>({
    name: supplier?.name ?? '',
    contactName: supplier?.contactName ?? '',
    phone: supplier?.phone ?? '',
    notes: supplier?.notes ?? '',
  })
  const [touched, setTouched] = useState(false)
  const [pending, setPending] = useState(false)
  const otherNames = allSuppliers
    .filter((s) => s.id !== supplier?.id)
    .map((s) => s.name.trim().toLowerCase())
  const error = validateSupplier(v, otherNames)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (error) return
    setPending(true)
    try {
      if (supplier) {
        await updateSupplier(user?.uid ?? '', supplier, v)
        toast.success('Proveedor actualizado')
        onDone()
      } else {
        const id = await createSupplier(user?.uid ?? '', v)
        toast.success('Proveedor creado')
        onDone(id)
      }
    } catch (err) {
      toast.error(`No se pudo guardar: ${(err as Error).message}`)
    } finally {
      setPending(false)
    }
  }

  const set = (k: keyof SupplierInput) => (e: { target: { value: string } }) =>
    setV((x) => ({ ...x, [k]: e.target.value }))

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle className="text-title">
          {supplier ? 'Editar proveedor' : 'Nuevo proveedor'}
        </DialogTitle>
        <DialogDescription className="text-label">Solo el nombre es obligatorio.</DialogDescription>
      </DialogHeader>
      <FormField id="sup-name" label="Nombre" error={touched && error ? error : undefined}>
        <Input id="sup-name" maxLength={80} value={v.name} onChange={set('name')} autoFocus />
      </FormField>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="sup-contact" label="Contacto (opcional)">
          <Input
            id="sup-contact"
            maxLength={80}
            value={v.contactName}
            onChange={set('contactName')}
          />
        </FormField>
        <FormField id="sup-phone" label="Teléfono o WhatsApp (opcional)">
          <Input
            id="sup-phone"
            inputMode="tel"
            maxLength={30}
            value={v.phone}
            onChange={set('phone')}
          />
        </FormField>
      </div>
      <FormField id="sup-notes" label="Notas (opcional)">
        <Textarea
          id="sup-notes"
          maxLength={300}
          placeholder="Días de visita, condiciones de pago…"
          value={v.notes}
          onChange={set('notes')}
        />
      </FormField>
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          {supplier ? 'Guardar' : 'Crear proveedor'}
        </Button>
      </DialogFooter>
    </form>
  )
}
