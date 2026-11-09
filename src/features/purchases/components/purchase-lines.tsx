import { useMemo, useState } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import { IntegerInput, MoneyInput } from '@/components/shared/inputs'
import { Input } from '@/components/ui/input'
import { formatCop } from '@/domain/money'
import type { Product } from '@/features/products/domain/catalog'
import { cn } from '@/lib/utils'
import { unitCostFromPack } from '../domain/purchases'
import { lineTotal, newLine, toDraft, type EditableLine } from '../domain/editable-lines'

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * Editor de líneas de un pedido o una compra: buscar productos, cantidad y costo, en unidades o
 * en la unidad de compra del producto (canasta, paca…).
 */
export function LineEditor({
  lines,
  onChange,
  products,
  costOf,
  costLabel,
}: {
  lines: EditableLine[]
  onChange: (lines: EditableLine[]) => void
  products: Product[]
  /** Costo de referencia por unidad (último del proveedor o del producto). */
  costOf: (p: Product) => number
  costLabel: string
}) {
  const [search, setSearch] = useState('')
  const used = new Set(lines.map((l) => l.productId))
  const matches = useMemo(() => {
    const q = norm(search.trim())
    if (!q) return []
    return products
      .filter((p) => p.active && !used.has(p.id) && norm(p.name).includes(q))
      .slice(0, 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, products, lines])

  const update = (i: number, patch: Partial<EditableLine>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  function switchMode(i: number, mode: EditableLine['mode']) {
    const l = lines[i]!
    if (!l.unit || l.mode === mode) return
    const n = l.unit.units
    update(i, {
      mode,
      qty:
        l.qty === null ? null : mode === 'pack' ? (l.qty % n === 0 ? l.qty / n : null) : l.qty * n,
      cost: l.cost === null ? null : mode === 'pack' ? l.cost * n : unitCostFromPack(l.cost, n),
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label="Buscar producto para agregar"
          placeholder="Buscar producto para agregar…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
        {matches.length > 0 && (
          <ul className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border-strong bg-popover shadow-lg shadow-black/30">
            {matches.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center justify-between gap-4 px-4 py-2.5 text-left hover:bg-raised"
                  onClick={() => {
                    onChange([...lines, newLine(p, costOf(p))])
                    setSearch('')
                  }}
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="inline-flex items-center gap-1 text-meta text-muted-foreground">
                    <Plus aria-hidden className="size-3.5" /> Stock {p.stock}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {lines.length === 0 ? (
        <p className="rounded-xl border border-dashed px-5 py-8 text-center text-label text-muted-foreground">
          Busca y agrega los productos.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border bg-card">
          {lines.map((l, i) => {
            const d = toDraft(l)
            const packName = l.unit?.name.toLowerCase()
            return (
              <li key={l.productId} className="flex flex-col gap-3 px-4 py-3 sm:px-5">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">{l.name}</p>
                  <button
                    type="button"
                    aria-label={`Quitar ${l.name}`}
                    onClick={() => onChange(lines.filter((_, j) => j !== i))}
                    className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-raised hover:text-destructive"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                </div>
                {l.unit && (
                  <div role="group" aria-label="Comprar por" className="flex gap-2">
                    {(['pack', 'unidad'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={l.mode === m}
                        onClick={() => switchMode(i, m)}
                        className={cn(
                          'h-9 cursor-pointer rounded-lg border px-3 text-label',
                          l.mode === m
                            ? 'border-primary bg-primary/15 text-foreground'
                            : 'text-muted-foreground hover:bg-raised',
                        )}
                      >
                        {m === 'pack' ? `Por ${packName} (${l.unit!.units})` : 'Por unidad'}
                      </button>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5 text-label text-muted-foreground">
                    {l.mode === 'pack' ? `Cantidad (${packName}s)` : 'Cantidad (unidades)'}
                    <IntegerInput
                      value={l.qty}
                      onChange={(qty) => update(i, { qty })}
                      aria-label={`Cantidad de ${l.name}`}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-label text-muted-foreground">
                    {l.mode === 'pack' ? `${costLabel} por ${packName}` : `${costLabel} por unidad`}
                    <MoneyInput
                      value={l.cost}
                      onChange={(cost) => update(i, { cost })}
                      aria-label={`Costo de ${l.name}`}
                    />
                  </label>
                </div>
                <p className="text-meta text-subtle-foreground">
                  {d.qty ? `${d.qty} unidades` : 'Sin cantidad'}
                  {d.estUnitCost !== null && ` a ${formatCop(d.estUnitCost)} cada una`}
                  {lineTotal(l) > 0 && (
                    <span className="font-medium text-foreground">
                      {' '}
                      = {formatCop(lineTotal(l))}
                    </span>
                  )}
                </p>
              </li>
            )
          })}
        </ul>
      )}
      {lines.length > 0 && (
        <p className="flex justify-between gap-4 rounded-xl border bg-card px-5 py-3 font-semibold">
          <span>Total</span>
          <span className="tabular">{formatCop(lines.reduce((s, l) => s + lineTotal(l), 0))}</span>
        </p>
      )}
    </div>
  )
}
