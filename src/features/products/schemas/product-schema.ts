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
  })
  .superRefine((v, ctx) => {
    if (v.pricingMode === 'manual' && v.manualPrice === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['manualPrice'],
        message: 'Escribe el precio de venta.',
      })
    }
    if (v.markupMode === 'custom' && v.markupBp === null) {
      ctx.addIssue({ code: 'custom', path: ['markupBp'], message: 'Escribe el recargo.' })
    }
  })

export type ProductFormValues = z.infer<typeof productFormSchema>
