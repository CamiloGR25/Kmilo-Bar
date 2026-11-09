import { z } from 'zod'
import { UNITS } from '../domain/catalog'

const cop = (label: string) =>
  z
    .number({ error: `Escribe ${label}.` })
    .int(`${label[0]?.toUpperCase()}${label.slice(1)} debe ser un monto sin decimales.`)
    .min(0, 'No puede ser negativo.')
    .max(100_000_000, 'El monto es demasiado alto.')

export const productFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Escribe el nombre.').max(80, 'Máximo 80 caracteres.'),
    description: z.string().max(300, 'Máximo 300 caracteres.'),
    categoryId: z.string().min(1, 'Elige una categoría.'),
    unit: z.enum(UNITS),
    cost: cop('el costo'),
    pricingMode: z.enum(['auto', 'manual']),
    markupMode: z.enum(['global', 'custom']),
    /** Recargo propio en bp (solo si markupMode = custom). */
    markupBp: z.number().int().min(0).max(1_000_000).nullable(),
    manualPrice: cop('el precio').nullable(),
    minStock: z
      .number({ error: 'Escribe una cantidad.' })
      .int('Debe ser un número entero.')
      .min(0, 'No puede ser negativo.')
      .max(100_000, 'Demasiado alto.'),
    active: z.boolean(),
    /** Proveedor habitual ('' = ninguno). */
    supplierId: z.string(),
    /** Unidad de compra ('' = se compra por unidad). */
    purchaseUnit: z.string().trim().max(30, 'Máximo 30 caracteres.'),
    unitsPerPurchase: z
      .number({ error: 'Escribe cuántas unidades trae.' })
      .int('Debe ser un número entero.')
      .min(2, 'Debe traer al menos 2 unidades.')
      .max(1000, 'Demasiado alto.')
      .nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.pricingMode === 'manual' && v.manualPrice === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['manualPrice'],
        message: 'Escribe el precio de venta.',
      })
    }
    if (v.purchaseUnit.trim() && v.unitsPerPurchase === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['unitsPerPurchase'],
        message: 'Escribe cuántas unidades trae.',
      })
    }
    if (v.markupMode === 'custom' && v.markupBp === null) {
      ctx.addIssue({ code: 'custom', path: ['markupBp'], message: 'Escribe el recargo.' })
    }
  })

export type ProductFormValues = z.infer<typeof productFormSchema>
