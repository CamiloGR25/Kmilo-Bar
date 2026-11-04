/**
 * Constantes fijas del negocio. NO se exponen en Configuración (PRODUCT_REQUIREMENTS M12).
 * Cambiarlas exige una nueva decisión en docs/DECISIONS.md.
 */

/** Moneda única del sistema (D-000). */
export const CURRENCY = 'COP' as const

/** Locale para formatos de número y fecha. */
export const LOCALE = 'es-CO' as const

/** Zona horaria del negocio (D-000). Colombia no tiene horario de verano. */
export const TIME_ZONE = 'America/Bogota' as const

/** Hora (0-23) en que termina la jornada operativa (D-104). */
export const BUSINESS_DAY_CUTOFF_HOUR = 6

/** Paso de redondeo hacia arriba del precio sugerido, en COP (D-106). */
export const DEFAULT_ROUNDING_STEP = 100

/** Método de valorización de inventario (D-105). */
export const VALUATION_METHOD = 'promedio_ponderado' as const
