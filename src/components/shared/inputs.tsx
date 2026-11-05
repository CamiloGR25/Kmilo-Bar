/**
 * Campos numéricos con formato colombiano. Guardan enteros; muestran puntos de miles.
 */
import { forwardRef, useEffect, useState, type ComponentProps } from 'react'
import { ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const groupFormatter = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })

type BaseProps = Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type'> & {
  value: number | null
  onChange: (value: number | null) => void
}

/** Monto en pesos: "$" fijo a la izquierda y puntos de miles mientras se escribe. */
export const MoneyInput = forwardRef<HTMLInputElement, BaseProps>(function MoneyInput(
  { value, onChange, className, ...props },
  ref,
) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3.5 z-10 grid place-items-center text-muted-foreground">
        $
      </span>
      <IntegerInput
        ref={ref}
        value={value}
        onChange={onChange}
        className={cn('pl-8', className)}
        {...props}
      />
    </div>
  )
})

/** Entero con puntos de miles y sufijo opcional (ej. "%" o "unid."). */
export const IntegerInput = forwardRef<HTMLInputElement, BaseProps & { suffix?: string }>(
  function IntegerInput({ value, onChange, suffix, className, ...props }, ref) {
    const [text, setText] = useState(value === null ? '' : groupFormatter.format(value))

    // Sincroniza cuando el valor cambia desde fuera (ej. reset del formulario).
    useEffect(() => {
      const current = text.replace(/\./g, '')
      if (String(value ?? '') !== current)
        setText(value === null ? '' : groupFormatter.format(value))
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value])

    return (
      <div className="relative">
        <Input
          ref={ref}
          inputMode="numeric"
          autoComplete="off"
          value={text}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '').slice(0, 12)
            if (digits === '') {
              setText('')
              onChange(null)
              return
            }
            const n = Number(digits)
            setText(groupFormatter.format(n))
            onChange(n)
          }}
          className={cn('tabular', suffix && 'pr-14', className)}
          {...props}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3.5 grid place-items-center text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    )
  },
)

/** Porcentaje con hasta 2 decimales (coma decimal). Devuelve el valor en %. */
export const PercentInput = forwardRef<HTMLInputElement, BaseProps>(function PercentInput(
  { value, onChange, className, ...props },
  ref,
) {
  const fmt = (v: number | null) => (v === null ? '' : String(v).replace('.', ','))
  const [text, setText] = useState(fmt(value))
  useEffect(() => {
    const parsed = text === '' ? null : Number(text.replace(',', '.'))
    if (parsed !== value) setText(fmt(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <div className="relative">
      <Input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onChange={(e) => {
          const raw = e.target.value.replace('.', ',').replace(/[^\d,]/g, '')
          if (!/^\d{0,4}(,\d{0,2})?$/.test(raw)) return
          setText(raw)
          onChange(raw === '' || raw === ',' ? null : Number(raw.replace(',', '.')))
        }}
        className={cn('pr-10 tabular', className)}
        {...props}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3.5 grid place-items-center text-muted-foreground">
        %
      </span>
    </div>
  )
})

/** Selector nativo con el estilo del tema (en el celular abre el selector del sistema). */
export const NativeSelect = forwardRef<HTMLSelectElement, ComponentProps<'select'>>(
  function NativeSelect({ className, children, ...props }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            'h-11 w-full cursor-pointer appearance-none rounded-lg border border-input bg-raised pr-10 pl-3.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 aria-invalid:border-destructive',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    )
  },
)
