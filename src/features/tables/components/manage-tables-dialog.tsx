import { useState } from 'react'
import { Check, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/features/auth/use-auth'
import { canChangeService, nextTableNumber, type Table } from '../domain/tables'
import {
  createTable,
  renameTable,
  TableError,
  updateTableService,
} from '../services/tables-service'

const errorText = (e: unknown) =>
  e instanceof TableError ? e.message : `No se pudo guardar: ${(e as Error).message}`

/** Crear, renombrar, poner fuera de servicio y desactivar mesas (F4-01). No se borran. */
export function ManageTablesDialog({
  open,
  onOpenChange,
  tables,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tables: Table[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-title">Administrar mesas</DialogTitle>
          <DialogDescription className="text-label">
            Las mesas no se borran: se desactivan. Una mesa con cuenta abierta no se puede
            desactivar ni poner fuera de servicio.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col divide-y divide-border rounded-xl border">
          {tables.map((t) => (
            <TableRow key={t.id} table={t} />
          ))}
        </ul>
        <NewTableForm nextNumber={nextTableNumber(tables)} />
      </DialogContent>
    </Dialog>
  )
}

function TableRow({ table }: { table: Table }) {
  const { user } = useAuth()
  const uid = user?.uid ?? ''
  const [name, setName] = useState(table.name)
  const [pending, setPending] = useState(false)
  const locked = !canChangeService(table)

  async function run(fn: () => Promise<void>, ok: string) {
    setPending(true)
    try {
      await fn()
      toast.success(ok)
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim() !== table.name) {
            void run(() => renameTable(uid, table, name), 'Nombre guardado')
          }
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor={`name-${table.id}`} className="text-meta text-subtle-foreground">
            Mesa {table.number}
          </Label>
          <Input
            id={`name-${table.id}`}
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          size="icon"
          aria-label={`Guardar nombre de la mesa ${table.number}`}
          disabled={pending || name.trim() === table.name || name.trim() === ''}
        >
          {pending ? <Loader2 aria-hidden className="animate-spin" /> : <Check aria-hidden />}
        </Button>
      </form>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-label">
          <Switch
            checked={table.status === 'fuera_servicio'}
            disabled={pending || locked || !table.active}
            onCheckedChange={(v) =>
              run(
                () => updateTableService(uid, table, { outOfService: v }),
                v ? 'Mesa fuera de servicio' : 'Mesa disponible',
              )
            }
          />
          Fuera de servicio
        </label>
        <label className="flex items-center gap-2 text-label">
          <Switch
            checked={table.active}
            disabled={pending || locked}
            onCheckedChange={(v) =>
              run(
                () => updateTableService(uid, table, { active: v }),
                v ? 'Mesa activada' : 'Mesa desactivada',
              )
            }
          />
          Activa
        </label>
        {locked && (
          <span className="text-meta text-subtle-foreground">Tiene una cuenta abierta</span>
        )}
      </div>
    </li>
  )
}

function NewTableForm({ nextNumber }: { nextNumber: number }) {
  const { user } = useAuth()
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    try {
      await createTable(user?.uid ?? '', nextNumber, name.trim() || `Mesa ${nextNumber}`)
      toast.success(`Mesa ${nextNumber} creada`)
      setName('')
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Label htmlFor="new-table">Nueva mesa (número {nextNumber})</Label>
        <Input
          id="new-table"
          value={name}
          maxLength={40}
          placeholder={`Mesa ${nextNumber}`}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 aria-hidden className="animate-spin" /> : <Plus aria-hidden />}
        Agregar
      </Button>
    </form>
  )
}
