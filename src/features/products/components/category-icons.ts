import {
  Beer,
  CupSoda,
  Citrus,
  Cookie,
  GlassWater,
  Martini,
  Package,
  Wine,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { CategoryIcon as IconKey } from '../domain/catalog'

export const CATEGORY_ICON_COMPONENTS: Record<IconKey, LucideIcon> = {
  beer: Beer,
  wine: Wine,
  martini: Martini,
  'glass-water': GlassWater,
  'cup-soda': CupSoda,
  citrus: Citrus,
  zap: Zap,
  cookie: Cookie,
  package: Package,
}

export const CATEGORY_ICON_LABELS: Record<IconKey, string> = {
  beer: 'Cerveza',
  wine: 'Botella',
  martini: 'Copa',
  'glass-water': 'Agua',
  'cup-soda': 'Gaseosa',
  citrus: 'Cítrico',
  zap: 'Energía',
  cookie: 'Snack',
  package: 'Paquete',
}
