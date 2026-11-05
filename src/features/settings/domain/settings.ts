/**
 * Configuración general del negocio (documento settings/general).
 * Constantes fijas que NO están aquí (src/config): moneda, zona horaria, corte de jornada,
 * método de valorización.
 */
import { z } from 'zod'
import type { Bp, Cop } from '@/domain/money'

export interface Settings {
  businessName: string
  /** Recargo general sobre el costo (bp). */
  globalMarkupBp: Bp
  /** Paso de redondeo hacia arriba del precio sugerido (D-106). */
  roundingStep: Cop
  /** Stock mínimo que se propone al crear un producto. */
  defaultMinStock: number
  /** "Cerca del mínimo" = stock ≤ mínimo × factor (R-INV-06). */
  nearMinFactorBp: Bp
  /** Stock objetivo para recomendaciones = mínimo × factor (R-INV-08). */
  targetStockFactorBp: Bp
  supplierLeadDays: number
  safetyDays: number
  /** Tope de descuento por cuenta (P-04). */
  discountCapBp: Bp
  /** Correo para reportes (Fase 10). */
  reportEmail: string | null
}

export const ROUNDING_STEPS = [50, 100, 500, 1000] as const

export const DEFAULT_SETTINGS: Settings = {
  businessName: 'Kmilo Bar',
  globalMarkupBp: 5000,
  roundingStep: 100,
  defaultMinStock: 6,
  nearMinFactorBp: 15000,
  targetStockFactorBp: 20000,
  supplierLeadDays: 2,
  safetyDays: 2,
  discountCapBp: 2000,
  reportEmail: null,
}

/** Formulario de configuración (porcentajes en %, no en bp). */
export const settingsFormSchema = z.object({
  businessName: z
    .string()
    .trim()
    .min(1, 'Escribe el nombre del negocio.')
    .max(80, 'Máximo 80 caracteres.'),
  globalMarkupPercent: z
    .number({ error: 'Escribe un porcentaje.' })
    .min(0, 'No puede ser negativo.')
    .max(1000, 'Máximo 1000 %.'),
  roundingStep: z.union(ROUNDING_STEPS.map((s) => z.literal(s))),
  defaultMinStock: z
    .number({ error: 'Escribe una cantidad.' })
    .int('Debe ser un número entero.')
    .min(0, 'No puede ser negativo.')
    .max(10000, 'Demasiado alto.'),
  nearMinPercent: z
    .number({ error: 'Escribe un porcentaje.' })
    .min(100, 'Debe ser al menos 100 %.')
    .max(500, 'Máximo 500 %.'),
})

export type SettingsFormValues = z.infer<typeof settingsFormSchema>

/** Campos que cambiaron (para auditoría y para saber si recalcular precios). */
export function diffSettings(before: Settings, after: Settings): (keyof Settings)[] {
  return (Object.keys(after) as (keyof Settings)[]).filter((k) => before[k] !== after[k])
}

/** Lee un documento de Firestore aplicando valores por defecto a campos ausentes. */
export function settingsFromDoc(data: Record<string, unknown> | undefined): Settings {
  const d = data ?? {}
  const num = (k: keyof Settings) =>
    typeof d[k] === 'number' ? (d[k] as number) : (DEFAULT_SETTINGS[k] as number)
  return {
    businessName:
      typeof d.businessName === 'string' ? d.businessName : DEFAULT_SETTINGS.businessName,
    globalMarkupBp: num('globalMarkupBp'),
    roundingStep: num('roundingStep'),
    defaultMinStock: num('defaultMinStock'),
    nearMinFactorBp: num('nearMinFactorBp'),
    targetStockFactorBp: num('targetStockFactorBp'),
    supplierLeadDays: num('supplierLeadDays'),
    safetyDays: num('safetyDays'),
    discountCapBp: num('discountCapBp'),
    reportEmail: typeof d.reportEmail === 'string' ? d.reportEmail : null,
  }
}
