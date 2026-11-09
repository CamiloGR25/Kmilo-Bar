import { formatDate } from '@/domain/dates'
import { formatCop } from '@/domain/money'
import type { InventoryMovement } from '@/features/inventory/services/inventory-service'
import { costStatsBySupplier } from '../domain/purchases'
import { useSuppliers } from '../services/purchases-service'

/**
 * Comparación de precios de compra de un producto (D-223 #8, F-15): último, más barato y
 * promedio por proveedor, a partir de las entradas de compra del kardex.
 */
export function PurchasePrices({ movements }: { movements: readonly InventoryMovement[] }) {
  const suppliers = useSuppliers()
  const names = new Map((suppliers.data ?? []).map((s) => [s.id, s.name]))
  const stats = costStatsBySupplier(
    movements
      .filter((m) => m.type === 'entrada_compra')
      .map((m) => ({
        supplierId: m.supplierId,
        qty: m.qty,
        unitCost: m.unitCost,
        at: m.createdAt,
      })),
  )
  if (stats.length === 0) return null
  const cheapest = stats[0]!.last
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-title font-semibold">Precios de compra</h2>
        <p className="text-label text-muted-foreground">Por unidad, según las compras recibidas.</p>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[32rem] text-label">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th scope="col" className="px-4 py-3 text-left font-medium">
                Proveedor
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Último
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Más barato
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                Promedio
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {stats.map((s) => (
              <tr key={s.supplierId ?? '-'}>
                <td className="px-4 py-2.5">
                  <span className="font-medium">
                    {(s.supplierId && names.get(s.supplierId)) ?? 'Sin proveedor'}
                  </span>
                  <span className="block text-meta text-subtle-foreground">
                    {s.qty} unidades{s.lastAt ? `, última el ${formatDate(s.lastAt)}` : ''}
                  </span>
                </td>
                <td
                  className={`px-4 py-2.5 text-right tabular ${s.last === cheapest && stats.length > 1 ? 'font-semibold text-success' : ''}`}
                >
                  {formatCop(s.last)}
                </td>
                <td className="px-4 py-2.5 text-right tabular">{formatCop(s.min)}</td>
                <td className="px-4 py-2.5 text-right tabular">{formatCop(s.avg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
