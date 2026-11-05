import {
  BarChart3,
  Boxes,
  ClipboardList,
  FileText,
  Home,
  LayoutGrid,
  Package,
  Receipt,
  ReceiptText,
  Settings,
  ShoppingBag,
  TrendingUp,
  Truck,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Fase del ROADMAP en la que se construye el módulo. */
  phase: number
  /** Aparece en la barra inferior del celular (máximo 4 + "Más"). */
  mobile?: boolean
}

/** Navegación principal, en el orden de DESIGN_SYSTEM §6. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Inicio', icon: Home, phase: 6 },
  { to: '/mesas', label: 'Mesas', icon: LayoutGrid, phase: 4, mobile: true },
  { to: '/barra', label: 'Venta en barra', icon: ShoppingBag, phase: 4, mobile: true },
  { to: '/cuentas', label: 'Cuentas', icon: ReceiptText, phase: 4 },
  { to: '/caja', label: 'Caja', icon: Wallet, phase: 4, mobile: true },
  { to: '/ventas', label: 'Ventas', icon: TrendingUp, phase: 6 },
  { to: '/inventario', label: 'Inventario', icon: Boxes, phase: 3, mobile: true },
  { to: '/productos', label: 'Productos', icon: Package, phase: 2 },
  { to: '/compras', label: 'Compras', icon: ClipboardList, phase: 7 },
  { to: '/proveedores', label: 'Proveedores', icon: Truck, phase: 7 },
  { to: '/gastos', label: 'Gastos', icon: Receipt, phase: 8 },
  { to: '/finanzas', label: 'Finanzas', icon: BarChart3, phase: 8 },
  { to: '/reportes', label: 'Reportes', icon: FileText, phase: 9 },
  { to: '/configuracion', label: 'Configuración', icon: Settings, phase: 2 },
]
