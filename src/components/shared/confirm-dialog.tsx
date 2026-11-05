import { useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/**
 * Confirmación de operaciones importantes. Con `requireReason`, exige escribir el motivo
 * (DESIGN_SYSTEM §9: las operaciones críticas piden motivo).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  requireReason,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirmLabel: string
  destructive?: boolean
  requireReason?: boolean
  onConfirm: (reason: string | null) => Promise<void> | void
}) {
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const canConfirm = !requireReason || reason.trim().length >= 3

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!pending) {
          onOpenChange(o)
          if (!o) setReason('')
        }
      }}
    >
      <AlertDialogContent className="data-[size=default]:sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-title">{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {requireReason && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm-reason">Motivo</Label>
            <Textarea
              id="confirm-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              placeholder="Escribe por qué haces este cambio"
            />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="outline" disabled={pending}>
              Cancelar
            </Button>
          </AlertDialogCancel>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={!canConfirm || pending}
            onClick={async () => {
              setPending(true)
              try {
                await onConfirm(requireReason ? reason.trim() : null)
                setReason('')
                onOpenChange(false)
              } finally {
                setPending(false)
              }
            }}
          >
            {pending && <Loader2 aria-hidden className="animate-spin" />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
