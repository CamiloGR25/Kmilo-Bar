import { useMemo, useState } from 'react'
import { Check, Copy, Loader2, PartyPopper } from 'lucide-react'
import { Page, PageHeader } from '@/components/shared/page-header'
import { StockIndicator } from '@/components/shared/stock-indicator'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { bpToPercent, formatCop } from '@/domain/money'
import { CategoryIcon } from '@/features/products/components/category-icon'
import { MIN_DAYS_FOR_SUGGESTION } from '../domain/stock'
import { useInventory, type InventoryItem } from '../hooks/use-inventory'

/**
 * Recomendaciones de pedido (D-102, R-INV-08): productos en mínimo o agotados con la cantidad
 * sugerida para volver al stock objetivo. Los pedidos a proveedores llegan en la Fase 7.
 */
export function RecommendationsPage() {
  const { items, settings, loading } = useInventory()
  const [includeNear, setIncludeNear] = useState(false)
  const [copied, setCopied] = useState(false)

  const list = useMemo(
    () =>
      (items ?? []).filter(
        (i) =>
          i.suggestedQty > 0 &&
          (i.level === 'agotado' || i.level === 'minimo' || (includeNear && i.level === 'cerca')),
      ),
    [items, includeNear],
  )

  const groups = useMemo(() => {
    const m = new Map<string, InventoryItem[]>()
    for (const i of list) {
      const key = i.category?.name ?? 'Sin categoría'
      m.set(key, [...(m.get(key) ?? []), i])
    }
    return [...m.entries()]
  }, [list])

  const unitCost = (i: InventoryItem) => i.product.lastPurchaseCost || i.product.avgCost
  const total = list.reduce((acc, i) => acc + i.suggestedQty * unitCost(i), 0)

  async function copy() {
    const text = [
      `Pedido ${settings?.businessName ?? ''}`.trim(),
      ...groups.flatMap(([cat, its]) => [
        '',
        cat,
        ...its.map((i) => `- ${i.suggestedQty} × ${i.product.name}`),
      ]),
    ].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Page wide>
      <PageHeader
        title="Qué pedir"
        description={
          settings
            ? `Cantidad para volver a ${bpToPercent(settings.targetStockFactorBp) / 100} veces el stock mínimo, según el último costo de compra.`
            : undefined
        }
        back={{ to: '/inventario', label: 'Inventario' }}
        actions={
          list.length > 0 && (
            <Button variant="outline" onClick={copy}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? 'Lista copiada' : 'Copiar lista'}
            </Button>
          )
        }
      />

      <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border bg-card px-5 py-4">
        <span>
          <span className="block font-medium">Incluir productos cerca del mínimo</span>
          <span className="text-meta text-subtle-foreground">
            Útil para aprovechar un mismo pedido al proveedor.
          </span>
        </span>
        <Switch checked={includeNear} onCheckedChange={setIncludeNear} />
      </label>

      {loading ? (
        <p className="inline-flex items-center gap-2 text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Cargando…
        </p>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed bg-card p-6">
          <PartyPopper aria-hidden className="size-7 text-success" />
          <p className="text-title font-semibold">No hay nada urgente por pedir</p>
          <p className="text-label text-muted-foreground">
            Ningún producto activo está agotado ni en su stock mínimo.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-label text-muted-foreground">
              {list.length === 1 ? '1 producto' : `${list.length} productos`}
            </p>
            <p className="text-label text-muted-foreground">
              Costo estimado:{' '}
              <span className="tabular text-lg font-semibold text-foreground">
                {formatCop(total)}
              </span>
            </p>
          </div>
          {groups.map(([cat, its]) => (
            <section key={cat} className="flex flex-col gap-3">
              <h2 className="text-title font-semibold">{cat}</h2>
              <ul className="divide-y divide-border rounded-xl border bg-card">
                {its.map((i) => (
                  <li key={i.product.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <CategoryIcon icon={i.category?.icon ?? 'package'} />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 leading-snug font-medium">{i.product.name}</p>
                      <p className="text-meta text-subtle-foreground">
                        Hay {i.product.stock}, mínimo {i.product.minStock}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <p className="tabular text-lg leading-none font-semibold">
                        Pedir {i.suggestedQty}
                      </p>
                      <StockIndicator level={i.level} className="text-meta" />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}

      <p className="text-meta text-subtle-foreground">
        El stock mínimo sugerido según tus ventas estará disponible tras {MIN_DAYS_FOR_SUGGESTION}{' '}
        jornadas con ventas (Fase 4 en adelante). Mientras tanto se usa el mínimo que definiste en
        cada producto.
      </p>
    </Page>
  )
}
